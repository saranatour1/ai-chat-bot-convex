import { google } from '@ai-sdk/google';
import { abortStream, Agent, getFile, listUIMessages, stepCountIs, storeFile, ThreadDoc, vStreamArgs } from '@convex-dev/agent';
import { getAuthUserId } from '@convex-dev/auth/server';
import { customAction, customCtx, customMutation, customQuery } from 'convex-helpers/server/customFunctions';
import { paginationOptsValidator, type PaginationResult } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { components, internal } from '../_generated/api';
import { action as rawAction, internalAction, mutation as rawMutation, query as rawQuery } from '../_generated/server';
import { z } from 'zod';
import { Id } from '../_generated/dataModel';

export const mainAgent = new Agent(components.agent, {
  languageModel: google.chat("gemini-2.5-flash-lite") as any,
  name: "Random Agent",
  instructions: "You are a helpful assistant.",
  storageOptions: {
    saveMessages: 'all',
  },
  maxSteps: 10,
  stopWhen: stepCountIs(30),
});

const requireUserId = async (ctx: Parameters<typeof getAuthUserId>[0]) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError('not authenticated');
  return userId;
};

const getOwnedThreadOrThrow = async (
  ctx: {
    runQuery: (
      queryRef: typeof components.agent.threads.getThread,
      args: { threadId: string },
    ) => Promise<ThreadDoc | null>;
  },
  userId: string,
  threadId: string,
) => {
  const thread = await ctx.runQuery(components.agent.threads.getThread, { threadId });
  if (!thread || thread.userId !== userId) {
    throw new ConvexError('not authorized');
  }
  return thread;
};

export const authedQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ userId: await requireUserId(ctx) })),
);

export const authedMutation = customMutation(
  rawMutation,
  customCtx(async (ctx) => ({ userId: await requireUserId(ctx) })),
);

export const authedAction = customAction(
  rawAction,
  customCtx(async (ctx) => ({ userId: await requireUserId(ctx) })),
);

// list threads by userId
export const listThreadsByUserId = authedQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args): Promise<PaginationResult<ThreadDoc>> => {
    const threads = await ctx.runQuery(
      components.agent.threads.listThreadsByUserId,
      { userId: ctx.userId, paginationOpts: args.paginationOpts },
    );

    return threads;
  },
});

export const getThreadById = authedQuery({
  args: { threadId: v.string() },
  handler: async (
    ctx,
    args_0,
  ): Promise<{
    _creationTime: number;
    _id: string;
    status: 'active' | 'archived';
    summary?: string;
    title?: string;
    userId?: string;
  } | null> => {
    const thread = await getOwnedThreadOrThrow(ctx, ctx.userId, args_0.threadId);
    return thread;
  },
});

// view thread Messages
export const viewThreadMessagesById = authedQuery({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args_0) => {
    const { threadId, paginationOpts, streamArgs } = args_0;
    await getOwnedThreadOrThrow(ctx, ctx.userId, threadId);

    const streams = await mainAgent.syncStreams(ctx, { threadId, streamArgs, includeStatuses: ["aborted", "streaming", "finished"] });
    const paginated = await listUIMessages(ctx, components.agent, {
      threadId,
      paginationOpts,
    });

    return {
      ...paginated,
      streams,
    };
  },
});

export const createEmptyThread = authedMutation({
  handler: async (ctx) => {
    const { threadId } = await mainAgent.createThread(ctx, { userId: ctx.userId });
    return threadId;
  },
});


// delete chat history
export const deleteChatHistory = authedAction({
  args: { threadId: v.string() },
  handler: async (ctx, args_0) => {
    await getOwnedThreadOrThrow(ctx, ctx.userId, args_0.threadId);

    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId: args_0.threadId,
    });
  },
});

export const createTitleAndSummarizeChat = internalAction({
  args: { threadId: v.string(), lastMessageId: v.optional(v.string()) },
  handler: async (ctx, args_0) => {
    const { thread } = await mainAgent.continueThread(ctx, { threadId: args_0.threadId })
    const { title: oldTitle, summary: oldSummary } = await thread.getMetadata()
    if (!oldTitle || !oldSummary) {
      const threadContext = await mainAgent.fetchContextMessages(ctx, { threadId: thread.threadId, contextOptions: {}, userId: undefined, messages: [] })
      const o = await thread.generateObject({
        prompt: `summarize the following thread context, and bring back the title and summary object, ${JSON.stringify(threadContext)}`,
        schema: z.object({
          title: z.string(),
          summary: z.string()
        })
      }, { storageOptions: { saveMessages: "none" } })
      const t = o.toJsonResponse()
      if (t.ok) {
        const x: Partial<ThreadDoc> = await t.json()
        await thread.updateMetadata(x)
      } else {
        throw new ConvexError("Sadly, response was not ok")
      }
    }
  },
})

export const streamMessageAsynchronously = authedMutation({
  args: {
    prompt: v.string(), threadId: v.optional(v.string()), fileIds: v.optional(v.string()), body: v.optional(v.object({
      model: v.string(),
      tools: v.array(v.string())
    }))
  },
  handler: async (ctx, { prompt, threadId, fileIds }) => {
    const { userId } = ctx;

    let targetThreadId = threadId;
    if (targetThreadId) {
      await getOwnedThreadOrThrow(ctx, userId, targetThreadId);
    } else {
      const { threadId: newThreadId } = await mainAgent.createThread(ctx, { userId });
      targetThreadId = newThreadId;
    }

    const message = fileIds
      ? await (async () => {
        const { filePart, imagePart } = await getFile(ctx, components.agent, fileIds);
        return {
          role: "user" as const,
          content: [imagePart ?? filePart, { type: "text" as const, text: prompt }],
        };
      })()
      : {
        role: "user" as const,
        content: [{ type: "text" as const, text: prompt }],
      };

    const { messageId } = await mainAgent.saveMessage(ctx, {
      threadId: targetThreadId,
      userId,
      message,
      metadata: { fileIds: fileIds ? [fileIds] : undefined },
      // we're in a mutation, so skip embeddings for now. They'll be generated
      // lazily when streaming text.
      skipEmbeddings: true,
    });

    await ctx.scheduler.runAfter(0, internal.agent.index.streamMessage, {
      threadId: targetThreadId,
      promptMessageId: messageId,
    });

    await ctx.scheduler.runAfter(7, internal.agent.index.createTitleAndSummarizeChat, {
      threadId: targetThreadId,
    });
  },
});

export const streamMessage = internalAction({
  args: { promptMessageId: v.string(), threadId: v.string() },
  handler: async (ctx, { promptMessageId, threadId }) => {
    const { thread } = await mainAgent.continueThread(ctx, { threadId });
    const result = await thread.streamText(
      { promptMessageId },
      { saveStreamDeltas: true },
    );
    await result.consumeStream();
  },
});

export const stopStreaming = authedAction({
  args: { threadId: v.string() },
  handler: async (ctx, args_0) => {
    await getOwnedThreadOrThrow(ctx, ctx.userId, args_0.threadId);

    // Not properly working
    const data = await ctx.runQuery(components.agent.streams.list, { threadId: args_0.threadId })
    if (data[0]) {
      await abortStream(ctx, components.agent, {
        // threadId: args_0.threadId,
        streamId: data[0].streamId,
        reason: "stop"
      })

    } else {
      console.log("none are running right now")
    }
  }
})

// validate file upload 
// Step 1: Upload a file
export const uploadFile = authedAction({
  args: {
    phase: v.optional(v.union(v.literal("start"), v.literal("complete"), v.literal("legacy"))),
    filename: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    bytes: v.optional(v.bytes()),
    storageId: v.optional(v.id("_storage")),
    sha256: v.optional(v.string()),
  },
  handler: async (ctx, { phase, filename, mimeType, bytes, storageId, sha256 }) => {
    if (phase === "start") {
      const uploadUrl = await ctx.storage.generateUploadUrl();
      return { uploadUrl };
    }

    if (phase === "complete") {
      if (!storageId) throw new ConvexError("storageId is required");
      if (!filename) throw new ConvexError("filename is required");

      const metadata = await ctx.storage.getMetadata(storageId);
      if (!metadata) throw new ConvexError("Uploaded file was not found");

      const hash = sha256 ?? metadata.sha256;
      if (!hash) throw new ConvexError("Unable to determine file hash");
      if (sha256 && metadata.sha256 && metadata.sha256 !== sha256) {
        throw new ConvexError("File hash mismatch");
      }

      const reused = await ctx.runMutation(components.agent.files.useExistingFile, {
        hash,
        filename,
      });

      if (reused) {
        if (reused.storageId !== storageId) {
          await ctx.storage.delete(storageId);
        }
        const url = await ctx.storage.getUrl(reused.storageId as Id<"_storage">);
        if (!url) throw new ConvexError("Stored file URL is unavailable");
        return { fileId: reused.fileId, url, storageId: reused.storageId };
      }

      const { fileId, storageId: componentStorageId } = await ctx.runMutation(
        components.agent.files.addFile,
        {
          storageId,
          hash,
          filename,
          mimeType: mimeType ?? metadata.contentType ?? "application/octet-stream",
        },
      );

      const url = await ctx.storage.getUrl(componentStorageId as Id<"_storage">);
      if (!url) throw new ConvexError("Stored file URL is unavailable");
      return { fileId, url, storageId: componentStorageId };
    }

    // Backward-compatible path for any existing callers sending bytes directly.
    if (!filename || !mimeType || !bytes) {
      throw new ConvexError("Invalid upload arguments");
    }
    const { file } = await storeFile(
      ctx,
      components.agent,
      new Blob([bytes], { type: mimeType }),
      {
        filename,
        sha256,
      },
    );

    const { fileId, url, storageId: uploadedStorageId } = file;
    return { fileId, url, storageId: uploadedStorageId }
  },
});

export const popFile = authedAction({
  args: { fileId: v.string() },
  handler: async (ctx, args_0) => {
    await ctx.storage.delete(args_0.fileId as Id<"_storage">)
  },
})
