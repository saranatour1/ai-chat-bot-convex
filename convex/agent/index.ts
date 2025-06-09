// here we do everything for the backend according to these files in agent defined here
// https://github.com/get-convex/agent/blob/main/src/component
import { google } from '@ai-sdk/google';
// biome-ignore lint/style/useImportType: <explanation>
import { Agent, getFile, storeFile, ThreadDoc, vStreamArgs } from '@convex-dev/agent';
import { getAuthUserId } from '@convex-dev/auth/server';
import { paginationOptsValidator, type PaginationResult } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { components, internal } from '../_generated/api';
import { action, internalAction, mutation, query } from '../_generated/server';
import { z } from 'zod';
import { Id } from '../_generated/dataModel';

export const mainAgent = new Agent(components.agent, {
  chat: google.chat('gemini-2.5-flash-preview-04-17'),
  textEmbedding: google.textEmbeddingModel(`text-embedding-004`),
  contextOptions: {
    recentMessages: 20,
    searchOtherThreads: true,
    includeToolCalls: true,
  },
  storageOptions: {
    saveAllInputMessages: true,
    saveAnyInputMessages: true,
    saveOutputMessages: true,
  },
  maxSteps: 10,
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
    const streams = await mainAgent.syncStreams(ctx, { threadId, streamArgs });
    const paginated = await mainAgent.listMessages(ctx, {
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
  args: { prompt: v.string(), threadId: v.string(), fileId: v.string() },
  handler: async (ctx, { prompt, threadId, fileId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("not authenticated")


    const { filePart, imagePart } = await getFile(
      ctx,
      components.agent,
      fileId
    )
  
    const { messageId } = await mainAgent.saveMessage(ctx, {
      threadId,
      userId: userId,
      message: {
        role: "user",
        content: [imagePart ?? filePart, { type: "text", text: prompt }],
      },
      metadata: { fileIds: fileId ? [fileId] : undefined },
      // we're in a mutation, so skip embeddings for now. They'll be generated
      // lazily when streaming text.
      skipEmbeddings: true,
    });

    await ctx.scheduler.runAfter(0, internal.agent.index.streamMessage, {
      threadId,
      promptMessageId: messageId,
    });

    await ctx.scheduler.runAfter(7, internal.agent.index.createTitleAndSummarizeChat, {
      threadId: threadId
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


// validate file upload 
// Step 1: Upload a file
export const uploadFile = action({
  args: {
    filename: v.string(),
    mimeType: v.string(),
    bytes: v.bytes(),
    sha256: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    // Maybe rate limit how often a user can upload a file / attribute?
    if (!userId) {
      throw new Error("Unauthorized");
    }
    const {
      file: { fileId, url },
    } = await storeFile(
      ctx,
      components.agent,
      new Blob([args.bytes], { type: args.mimeType }),
      args.filename,
      args.sha256,
    );
    return { fileId, url };
  },
});

export const popFile = action({
  args: { fileId: v.string() },
  handler: async (ctx, args_0) => {
    await ctx.storage.delete(args_0.fileId as Id<"_storage">)
  },
})