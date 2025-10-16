import { google } from '@ai-sdk/google';
import { Agent, getFile, listUIMessages, stepCountIs, storeFile, ThreadDoc, vStreamArgs } from '@convex-dev/agent';
import { getAuthUserId } from '@convex-dev/auth/server';
import { paginationOptsValidator, type PaginationResult } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { components, internal } from '../_generated/api';
import { action, internalAction, mutation, query } from '../_generated/server';
import { z } from 'zod';
import { Id } from '../_generated/dataModel';
import { asyncMap } from 'convex-helpers'

export const mainAgent = new Agent(components.agent, {
  languageModel: google.chat('gemini-2.0-flash-lite'),
  name: "Random Agent",
  instructions: "You are a helpful assistant.",
  storageOptions: {
    saveMessages: 'all',
  },
  maxSteps: 10,
  stopWhen: stepCountIs(30),
  // tools: [
  //   google.tools.googleSearch({}),
  //   google.tools.urlContext({}),
  //   google.tools.codeExecution({})
  // ]
});

// list threads by userId
export const listThreadsByUserId = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args): Promise<PaginationResult<ThreadDoc>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError('not authenticated');

    const threads = await ctx.runQuery(
      components.agent.threads.listThreadsByUserId,
      { userId: userId, paginationOpts: args.paginationOpts },
    );

    return threads;
  },
});

export const getThreadById = query({
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
    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: args_0.threadId,
    });
    return thread;
  },
});

// view thread Messages
export const viewThreadMessagesById = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args_0) => {
    const { threadId, paginationOpts, streamArgs } = args_0;
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

export const createEmptyThread = mutation({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError("Not authenticated");
    }
    const { threadId } = await mainAgent.createThread(ctx, { userId });
    return threadId;
  },
});


// delete chat history
export const deleteChatHistory = action({
  args: { threadId: v.string() },
  handler: async (ctx, args_0) => {
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

export const streamMessageAsynchronously = mutation({
  args: {
    prompt: v.string(), threadId: v.optional(v.string()), fileIds: v.optional(v.string()), body: v.optional(v.object({
      model: v.string(),
      tools: v.array(v.string())
    }))
  },
  handler: async (ctx, { prompt, threadId, fileIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("not authenticated")

    let chatId: string | null = null;
    if (!threadId) {
      const lastUserThreadId = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
        userId: userId,
        paginationOpts: {
          cursor: null,
          numItems: 1
        }
      });
      chatId = lastUserThreadId?.page?.[0]._id;
    }

    if (fileIds) {
      console.log("I've been called", fileIds)
      const { filePart, imagePart } = await getFile(ctx, components.agent, fileIds)
      const { messageId } = await mainAgent.saveMessage(ctx, {
        threadId: threadId ? threadId : chatId as string,
        userId: userId,
        message: {
          role: "user",
          content: [imagePart ?? filePart, { type: "text", text: prompt }],
        },
        metadata: { fileIds: fileIds ? [fileIds] : undefined },
        // we're in a mutation, so skip embeddings for now. They'll be generated
        // lazily when streaming text.
        skipEmbeddings: true,
      });

      await ctx.scheduler.runAfter(0, internal.agent.index.streamMessage, {
        threadId: threadId ? threadId : chatId as string,
        promptMessageId: messageId,
      });
    } else {
      const { messageId } = await mainAgent.saveMessage(ctx, {
        threadId: threadId ? threadId : chatId as string,
        userId: userId,
        message: {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
        metadata: { fileIds: fileIds ? [fileIds] : undefined },
        // we're in a mutation, so skip embeddings for now. They'll be generated
        // lazily when streaming text.
        skipEmbeddings: true,
      });

      await ctx.scheduler.runAfter(0, internal.agent.index.streamMessage, {
        threadId: threadId ? threadId : chatId as string,
        promptMessageId: messageId,
      });
    }

    await ctx.scheduler.runAfter(7, internal.agent.index.createTitleAndSummarizeChat, {
      threadId: threadId ? threadId : chatId as string,
    })
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

export const stopStreaming = action({
  args: { threadId: v.string() },
  handler: async (ctx, args_0) => {
    // Not properly working
    const data = await ctx.runQuery(components.agent.streams.list, { threadId: args_0.threadId })
    if (data[0]) {
      // console.log("I ran", data[0].streamId)
      await ctx.runMutation(components.agent.streams.abort, {
        streamId: data?.[0]?.streamId,
        reason: "aborted"
      })

    } else {
      console.log("none are running right now")
    }
  }
})

// validate file upload 
// Step 1: Upload a file
export const uploadFile = action({
  args: {
    filename: v.string(),
    mimeType: v.string(),
    bytes: v.bytes(),
    sha256: v.optional(v.string()),
  },
  handler: async (ctx, { filename, mimeType, bytes, sha256 }) => {
    const userId = await getAuthUserId(ctx);
    // Maybe rate limit how often a user can upload a file / attribute?
    if (!userId) {
      throw new Error("Unauthorized");
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

    const { fileId, url, storageId } = file;
    return { fileId, url, storageId }
  },
});

export const popFile = action({
  args: { fileId: v.string() },
  handler: async (ctx, args_0) => {
    await ctx.storage.delete(args_0.fileId as Id<"_storage">)
  },
})