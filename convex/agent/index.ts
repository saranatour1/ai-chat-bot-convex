import { google } from '@ai-sdk/google';
import { abortStream, Agent, getFile, listUIMessages, stepCountIs, ThreadDoc, vStreamArgs } from '@convex-dev/agent';
import { getAuthUserId } from '@convex-dev/auth/server';
import { customAction, customCtx, customMutation, customQuery } from 'convex-helpers/server/customFunctions';
import { paginationOptsValidator, type PaginationResult } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { components, internal } from '../_generated/api';
import { action as rawAction, internalAction, mutation as rawMutation, query as rawQuery } from '../_generated/server';
import { z } from 'zod';
import { Id } from '../_generated/dataModel';
const AGENT_MODEL = process.env.CONVEX_AGENT_MODEL ?? "gemini-2.5-flash";
const TOOL_CALLS_PER_DAY_LIMIT = 3;
const URL_IN_PROMPT_PATTERN = /https?:\/\/[^\s<>"')]+/i;
const GOOGLE_TOOL_NAMES = ["google_search", "url_context"] as const;
type GoogleToolName = (typeof GOOGLE_TOOL_NAMES)[number];
const GOOGLE_TOOL_NAME_SET = new Set<string>(GOOGLE_TOOL_NAMES);

const normalizeRequestedTools = (tools?: string[]) => {
  const requestedTools = new Set<GoogleToolName>();
  for (const tool of tools ?? []) {
    if (GOOGLE_TOOL_NAME_SET.has(tool)) {
      requestedTools.add(tool as GoogleToolName);
    }
  }
  return requestedTools;
};

const buildGoogleTools = (requestedTools: ReadonlySet<GoogleToolName>) => {
  const tools: {
    google_search?: ReturnType<typeof google.tools.googleSearch>;
    url_context?: ReturnType<typeof google.tools.urlContext>;
  } = {};
  if (requestedTools.has("google_search")) {
    tools.google_search = google.tools.googleSearch({});
  }
  if (requestedTools.has("url_context")) {
    tools.url_context = google.tools.urlContext({});
  }
  return tools;
};

const normalizeGoogleModelId = (model?: string) => {
  if (!model) return undefined;
  return model.startsWith("google/") ? model.slice("google/".length) : model;
};

const getUtcDayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

export const mainAgent = new Agent(components.agent, {
  languageModel: google.chat(AGENT_MODEL),
  name: "Random Agent",
  instructions:
    "You are a helpful assistant. Use Google Search for up-to-date information when needed. When a prompt includes URLs, use URL context before answering.",
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

export const getToolCallRateLimitStatus = authedQuery({
  args: {},
  handler: async (ctx) => {
    const dayKey = getUtcDayKey(Date.now());
    const usage = await ctx.db
      .query("toolUsageDaily")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", ctx.userId).eq("dayKey", dayKey),
      )
      .unique();
    const used = usage?.count ?? 0;
    return {
      dayKey,
      limit: TOOL_CALLS_PER_DAY_LIMIT,
      used,
      remaining: Math.max(0, TOOL_CALLS_PER_DAY_LIMIT - used),
    };
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
  handler: async (ctx, { prompt, threadId, fileIds, body }) => {
    const { userId } = ctx;
    const requestedTools = normalizeRequestedTools(body?.tools);
    if (URL_IN_PROMPT_PATTERN.test(prompt)) {
      requestedTools.add("url_context");
    }

    let targetThreadId = threadId;
    if (targetThreadId) {
      await getOwnedThreadOrThrow(ctx, userId, targetThreadId);
    } else {
      const { threadId: newThreadId } = await mainAgent.createThread(ctx, { userId });
      targetThreadId = newThreadId;
    }
    if (requestedTools.size > 0) {
      const now = Date.now();
      const dayKey = getUtcDayKey(now);
      const usage = await ctx.db
        .query("toolUsageDaily")
        .withIndex("by_user_day", (q) =>
          q.eq("userId", userId).eq("dayKey", dayKey),
        )
        .unique();
      const used = usage?.count ?? 0;
      if (used >= TOOL_CALLS_PER_DAY_LIMIT) {
        throw new ConvexError(
          `tool call rate limit exceeded: ${TOOL_CALLS_PER_DAY_LIMIT} per day`,
        );
      }
      if (usage) {
        await ctx.db.patch(usage._id, { count: used + 1, updatedAt: now });
      } else {
        await ctx.db.insert("toolUsageDaily", {
          userId,
          dayKey,
          count: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
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
      model: body?.model,
      tools: [...requestedTools],
    });

    await ctx.scheduler.runAfter(7, internal.agent.index.createTitleAndSummarizeChat, {
      threadId: targetThreadId,
    });
  },
});

export const streamMessage = internalAction({
  args: {
    promptMessageId: v.string(),
    threadId: v.string(),
    model: v.optional(v.string()),
    tools: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { promptMessageId, threadId, model, tools }) => {
    const { thread } = await mainAgent.continueThread(ctx, { threadId });
    const normalizedModel = normalizeGoogleModelId(model);
    const requestedTools = normalizeRequestedTools(tools);
    const googleTools = buildGoogleTools(requestedTools);
    const hasGoogleTools = Object.keys(googleTools).length > 0;

    const result = await thread.streamText(
      {
        promptMessageId,
        ...(normalizedModel ? { model: google.chat(normalizedModel) } : {}),
        ...(hasGoogleTools
          ? {
              tools: googleTools,
              toolChoice: "auto" as const,
            }
          : {}),
      },
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

type UploadCtx = {
  storage: {
    generateUploadUrl: () => Promise<string>;
    getMetadata: (
      storageId: Id<"_storage">
    ) => Promise<{ sha256?: string | null; contentType?: string | null } | null>;
    getUrl: (storageId: Id<"_storage">) => Promise<string | null>;
    delete: (storageId: Id<"_storage">) => Promise<void>;
  };
  runMutation: (ref: any, args: any) => Promise<any>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForUploadedMetadata = async (
  ctx: UploadCtx,
  storageId: Id<"_storage">,
  attempts = 10,
  delayMs = 150,
) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const metadata = await ctx.storage.getMetadata(storageId);
    if (metadata) {
      return metadata;
    }
    if (attempt < attempts - 1) {
      await sleep(delayMs);
    }
  }
  return null;
};

const completeUpload = async (
  ctx: UploadCtx,
  {
    storageId,
    filename,
    mediaType,
    mimeType,
    sha256,
  }: {
    storageId: Id<"_storage">;
    filename: string;
    mediaType?: string;
    mimeType?: string;
    sha256?: string;
  },
) => {
  const metadata = await waitForUploadedMetadata(ctx, storageId);
  if (!metadata && !sha256) {
    throw new ConvexError("Uploaded file metadata is not ready. Please retry.");
  }

  const hash = sha256 ?? metadata?.sha256;
  if (!hash) throw new ConvexError("Unable to determine file hash");
  if (sha256 && metadata?.sha256 && metadata.sha256 !== sha256) {
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
      mimeType:
        mediaType ??
        mimeType ??
        metadata?.contentType ??
        "application/octet-stream",
    },
  );

  const url = await ctx.storage.getUrl(componentStorageId as Id<"_storage">);
  if (!url) throw new ConvexError("Stored file URL is unavailable");
  return { fileId, url, storageId: componentStorageId };
};

export const startFileUpload = authedAction({
  args: {},
  handler: async (ctx) => {
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl };
  },
});

export const completeFileUpload = authedAction({
  args: {
    storageId: v.id("_storage"),
    filename: v.string(),
    mediaType: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    sha256: v.optional(v.string()),
  },
  handler: async (ctx, { storageId, filename, mediaType, mimeType, sha256 }) => {
    return await completeUpload(ctx, {
      storageId,
      filename,
      mediaType: mediaType ?? mimeType,
      mimeType,
      sha256,
    });
  },
});

// Backward-compatible wrapper for existing callers.
export const uploadFile = authedAction({
  args: {
    phase: v.union(v.literal("start"), v.literal("complete")),
    filename: v.optional(v.string()),
    mediaType: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    sha256: v.optional(v.string()),
  },
  handler: async (ctx, { phase, filename, mediaType, mimeType, storageId, sha256 }) => {
    if (phase === "start") {
      const uploadUrl = await ctx.storage.generateUploadUrl();
      return { uploadUrl };
    }

    if (!storageId) throw new ConvexError("storageId is required");
    if (!filename) throw new ConvexError("filename is required");
    return await completeUpload(ctx, {
      storageId,
      filename,
      mediaType: mediaType ?? mimeType,
      mimeType,
      sha256,
    });
  },
});

export const popFile = authedAction({
  args: { fileId: v.string() },
  handler: async (ctx, args_0) => {
    await ctx.storage.delete(args_0.fileId as Id<"_storage">)
  },
})
