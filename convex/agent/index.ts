// here we do everything for the backend according to these files in agent defined here
// https://github.com/get-convex/agent/blob/main/src/component
import { google } from '@ai-sdk/google';
// biome-ignore lint/style/useImportType: <explanation>
import { Agent, ThreadDoc } from '@convex-dev/agent';
import { getAuthUserId } from '@convex-dev/auth/server';
import { paginationOptsValidator, type PaginationResult } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { components } from '../_generated/api';
import { action, query } from '../_generated/server';

const mainAgent = new Agent(components.agent, {
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

// view thread Messages
export const viewThreadMessagesById = query({
  args: { threadId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args_0) => {
    const threadMessages = await ctx.runQuery(
      components.agent.messages.listMessagesByThreadId,
      {
        threadId: args_0.threadId,
        order: 'desc',
        paginationOpts: args_0.paginationOpts,
      },
    );
    return threadMessages;
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


// get current active user thread
export const viewRunningThread = query({
  args:{},
  handler:async(ctx, args_0)=> {
    const userId = await getAuthUserId(ctx);
    if(!userId) throw new ConvexError("Not authenticated");
    
  },
})