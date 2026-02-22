import { google } from '@ai-sdk/google';
import { abortStream, Agent, getFile, listUIMessages, stepCountIs, ThreadDoc, vStreamArgs } from '@convex-dev/agent';
import { getAuthUserId } from '@convex-dev/auth/server';
import { customAction, customCtx, customMutation, customQuery } from 'convex-helpers/server/customFunctions';
import { paginationOptsValidator, type PaginationResult } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { components, internal } from '../_generated/api';
import { action as rawAction, internalAction, mutation as rawMutation, query as rawQuery } from '../_generated/server';
import { z } from 'zod';
import {
  checkRateLimit,
  rateLimit,
  THREAD_CREATIONS_PER_DAY_LIMIT,
  TOOL_CALLS_PER_DAY_LIMIT,
} from './rateLimits';
const AGENT_MODEL = process.env.CONVEX_AGENT_MODEL ?? "gemini-2.5-flash";
const URL_IN_PROMPT_PATTERN = /https?:\/\/[^\s<>"')]+/i;
const GOOGLE_TOOL_NAMES = ["google_search", "url_context"] as const;
const GOOGLE_SEARCH_MODE_VALUES = ["MODE_DYNAMIC", "MODE_UNSPECIFIED"] as const;
type GoogleToolName = (typeof GOOGLE_TOOL_NAMES)[number];
type GoogleSearchMode = (typeof GOOGLE_SEARCH_MODE_VALUES)[number];
type GoogleSearchToolInput = {
  enabled?: boolean;
  mode?: GoogleSearchMode;
  dynamicThreshold?: number;
};
type UrlContextToolInput = {
  enabled?: boolean;
};
type ToolInputsPayload = {
  google_search?: GoogleSearchToolInput;
  url_context?: UrlContextToolInput;
};
type ResolvedToolConfig = {
  google_search: {
    enabled: boolean;
    mode?: GoogleSearchMode;
    dynamicThreshold?: number;
  };
  url_context: {
    enabled: boolean;
  };
};
const GOOGLE_TOOL_NAME_SET = new Set<string>(GOOGLE_TOOL_NAMES);

const vGoogleSearchMode = v.union(
  v.literal("MODE_DYNAMIC"),
  v.literal("MODE_UNSPECIFIED"),
);
const vGoogleSearchToolInput = v.object({
  enabled: v.optional(v.boolean()),
  mode: v.optional(vGoogleSearchMode),
  dynamicThreshold: v.optional(v.number()),
});
const vUrlContextToolInput = v.object({
  enabled: v.optional(v.boolean()),
});
const vToolInputsPayload = v.object({
  google_search: v.optional(vGoogleSearchToolInput),
  url_context: v.optional(vUrlContextToolInput),
});
const vResolvedToolConfig = v.object({
  google_search: v.object({
    enabled: v.boolean(),
    mode: v.optional(vGoogleSearchMode),
    dynamicThreshold: v.optional(v.number()),
  }),
  url_context: v.object({
    enabled: v.boolean(),
  }),
});

const normalizeRequestedTools = (tools?: string[]) => {
  const requestedTools = new Set<GoogleToolName>();
  for (const tool of tools ?? []) {
    if (GOOGLE_TOOL_NAME_SET.has(tool)) {
      requestedTools.add(tool as GoogleToolName);
    }
  }
  return requestedTools;
};

const normalizeToolInputs = ({
  legacyTools,
  prompt,
  toolInputs,
}: {
  legacyTools?: string[];
  prompt: string;
  toolInputs?: ToolInputsPayload;
}): ResolvedToolConfig => {
  const requestedTools = normalizeRequestedTools(legacyTools);
  const googleSearchInput = toolInputs?.google_search;
  const urlContextInput = toolInputs?.url_context;

  let googleSearchEnabled = requestedTools.has("google_search");
  if (googleSearchInput?.enabled !== undefined) {
    googleSearchEnabled = googleSearchInput.enabled;
  }

  let urlContextEnabled = requestedTools.has("url_context");
  if (urlContextInput?.enabled !== undefined) {
    urlContextEnabled = urlContextInput.enabled;
  }
  if (urlContextInput?.enabled !== false && URL_IN_PROMPT_PATTERN.test(prompt)) {
    urlContextEnabled = true;
  }

  return {
    google_search: {
      enabled: googleSearchEnabled,
      mode: googleSearchInput?.mode,
      dynamicThreshold: googleSearchInput?.dynamicThreshold,
    },
    url_context: {
      enabled: urlContextEnabled,
    },
  };
};

const assertValidToolInputs = (toolInputs?: ToolInputsPayload) => {
  const dynamicThreshold = toolInputs?.google_search?.dynamicThreshold;
  if (dynamicThreshold === undefined) {
    return;
  }
  if (dynamicThreshold < 0 || dynamicThreshold > 1) {
    throw new ConvexError(
      "google_search.dynamicThreshold must be between 0 and 1",
    );
  }
};

const hasEnabledGoogleTools = (toolConfig: ResolvedToolConfig) =>
  toolConfig.google_search.enabled || toolConfig.url_context.enabled;

const buildGoogleToolsFromConfig = (toolConfig: ResolvedToolConfig) => {
  const tools: {
    google_search?: ReturnType<typeof google.tools.googleSearch>;
    url_context?: ReturnType<typeof google.tools.urlContext>;
  } = {};
  if (toolConfig.google_search.enabled) {
    const searchOptions: Parameters<typeof google.tools.googleSearch>[0] = {};
    if (toolConfig.google_search.mode) {
      searchOptions.mode = toolConfig.google_search.mode;
    }
    if (toolConfig.google_search.dynamicThreshold !== undefined) {
      searchOptions.dynamicThreshold = toolConfig.google_search.dynamicThreshold;
    }
    tools.google_search = google.tools.googleSearch(searchOptions);
  }
  if (toolConfig.url_context.enabled) {
    tools.url_context = google.tools.urlContext({});
  }
  return tools;
};

const normalizeGoogleModelId = (model?: string) => {
  if (!model) return undefined;
  return model.startsWith("google/") ? model.slice("google/".length) : model;
};

const defaultTools = {
  google_search: google.tools.googleSearch({}),
  url_context: google.tools.urlContext({}),
};
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
  tools: defaultTools,
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

const consumeToolRateLimitOrThrow = async (
  ctx: { db: Parameters<typeof rateLimit>[0]["db"] },
  userId: string,
) => {
  const result = await rateLimit(ctx, {
    name: "toolCallsPerDay",
    key: userId,
  });
  if (!result.ok) {
    throw new ConvexError(
      `tool call rate limit exceeded: ${TOOL_CALLS_PER_DAY_LIMIT} per day`,
    );
  }
};

const consumeThreadCreationRateLimitOrThrow = async (
  ctx: { db: Parameters<typeof rateLimit>[0]["db"] },
  userId: string,
) => {
  const result = await rateLimit(ctx, {
    name: "threadCreationsPerDay",
    key: userId,
  });
  if (!result.ok) {
    throw new ConvexError(
      `thread creation rate limit exceeded: ${THREAD_CREATIONS_PER_DAY_LIMIT} per day`,
    );
  }
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
    await consumeThreadCreationRateLimitOrThrow(ctx, ctx.userId);
    const { threadId } = await mainAgent.createThread(ctx, { userId: ctx.userId });
    return threadId;
  },
});

export const getToolCallRateLimitStatus = authedQuery({
  args: {},
  handler: async (ctx) => {
    const status = await checkRateLimit(ctx, {
      name: "toolCallsPerDay",
      key: ctx.userId,
      count: 0,
    });
    const remaining = status.ok
      ? Math.max(0, Math.floor(status.value))
      : 0;
    const used = Math.max(0, TOOL_CALLS_PER_DAY_LIMIT - remaining);
    return {
      limit: TOOL_CALLS_PER_DAY_LIMIT,
      used,
      remaining,
      retryAt: status.retryAt,
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
    prompt: v.string(),
    threadId: v.optional(v.string()),
    fileIds: v.optional(v.string()),
    body: v.optional(
      v.object({
        model: v.string(),
        tools: v.optional(v.array(v.string())),
        toolInputs: v.optional(vToolInputsPayload),
      }),
    ),
  },
  handler: async (ctx, { prompt, threadId, fileIds, body }) => {
    const { userId } = ctx;
    assertValidToolInputs(body?.toolInputs);
    const resolvedToolConfig = normalizeToolInputs({
      legacyTools: body?.tools,
      prompt,
      toolInputs: body?.toolInputs,
    });

    let targetThreadId = threadId;
    if (targetThreadId) {
      await getOwnedThreadOrThrow(ctx, userId, targetThreadId);
    } else {
      await consumeThreadCreationRateLimitOrThrow(ctx, userId);
      const { threadId: newThreadId } = await mainAgent.createThread(ctx, { userId });
      targetThreadId = newThreadId;
    }
    if (hasEnabledGoogleTools(resolvedToolConfig)) {
      await consumeToolRateLimitOrThrow(ctx, userId);
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
      tools: body?.tools,
      toolConfig: resolvedToolConfig,
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
    toolConfig: v.optional(vResolvedToolConfig),
  },
  handler: async (ctx, { promptMessageId, threadId, model, tools, toolConfig }) => {
    const { thread } = await mainAgent.continueThread(ctx, { threadId });
    const normalizedModel = normalizeGoogleModelId(model);
    const resolvedToolConfig =
      toolConfig ??
      normalizeToolInputs({
        legacyTools: tools,
        prompt: "",
      });
    const googleTools = buildGoogleToolsFromConfig(resolvedToolConfig);
    const hasGoogleTools = Object.keys(googleTools).length > 0;

    const result = await thread.streamText(
      {
        promptMessageId,
        ...(normalizedModel ? { model: google.chat(normalizedModel) } : {}),
        tools: googleTools,
        ...(hasGoogleTools
          ? {
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

export {
  completeFileUpload,
  popFile,
  startFileUpload,
  uploadFile,
} from './files';
