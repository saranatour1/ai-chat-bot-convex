// here we do everything for the backend according to these files in agent defined here
// https://github.com/get-convex/agent/blob/main/src/component
import { google } from '@ai-sdk/google';
// biome-ignore lint/style/useImportType: <explanation>
import { Agent, ThreadDoc, vStreamArgs } from '@convex-dev/agent';
import { getAuthUserId } from '@convex-dev/auth/server';
import { paginationOptsValidator, type PaginationResult } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { api, components, internal } from '../_generated/api';
import { action, internalAction, internalMutation, mutation, MutationCtx, query, QueryCtx } from '../_generated/server';

export const mainAgent = new Agent(components.agent, {
  name: 'Idea Manager Agent',
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

export const createThreadAndPrompt = action({
  args: { prompt: v.string() },
  handler: async (ctx, { prompt }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("not authenticated")
    // Start a new thread for the user.
    const { threadId, thread } = await mainAgent.createThread(ctx, { userId });
    // Creates a user message with the prompt, and an assistant reply message.
    const result = await thread.generateText({ prompt });
    return { threadId, text: result.text, };
  },
});

export const streamMessageAsynchronously = mutation({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {

    const { messageId } = await mainAgent.saveMessage(ctx, {
      threadId,
      prompt,
      // we're in a mutation, so skip embeddings for now. They'll be generated
      // lazily when streaming text.
      skipEmbeddings: true,
    });
    await ctx.scheduler.runAfter(0, internal.agent.index.streamMessage, {
      threadId,
      promptMessageId: messageId,
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

// last message sent in stream 
export const findLastMessage = query({
  args: { threadId: v.string() },
  handler: async (ctx, args_0) => {
    // const thread = await ctx.runQuery(components.agent.)
  },
})