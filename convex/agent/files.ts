import { getAuthUserId } from '@convex-dev/auth/server';
import { customAction, customCtx } from 'convex-helpers/server/customFunctions';
import { ConvexError, v } from 'convex/values';
import { components } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action as rawAction } from '../_generated/server';

const requireUserId = async (ctx: Parameters<typeof getAuthUserId>[0]) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError('not authenticated');
  return userId;
};

const authedAction = customAction(
  rawAction,
  customCtx(async (ctx) => ({ userId: await requireUserId(ctx) })),
);

type UploadCtx = {
  storage: {
    generateUploadUrl: () => Promise<string>;
    getMetadata: (
      storageId: Id<'_storage'>
    ) => Promise<{ sha256?: string | null; contentType?: string | null } | null>;
    getUrl: (storageId: Id<'_storage'>) => Promise<string | null>;
    delete: (storageId: Id<'_storage'>) => Promise<void>;
  };
  runMutation: (ref: any, args: any) => Promise<any>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForUploadedMetadata = async (
  ctx: UploadCtx,
  storageId: Id<'_storage'>,
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
    storageId: Id<'_storage'>;
    filename: string;
    mediaType?: string;
    mimeType?: string;
    sha256?: string;
  },
) => {
  const metadata = await waitForUploadedMetadata(ctx, storageId);
  if (!metadata && !sha256) {
    throw new ConvexError('Uploaded file metadata is not ready. Please retry.');
  }

  const hash = sha256 ?? metadata?.sha256;
  if (!hash) throw new ConvexError('Unable to determine file hash');
  if (sha256 && metadata?.sha256 && metadata.sha256 !== sha256) {
    throw new ConvexError('File hash mismatch');
  }

  const reused = await ctx.runMutation(components.agent.files.useExistingFile, {
    hash,
    filename,
  });

  if (reused) {
    if (reused.storageId !== storageId) {
      await ctx.storage.delete(storageId);
    }
    const url = await ctx.storage.getUrl(reused.storageId as Id<'_storage'>);
    if (!url) throw new ConvexError('Stored file URL is unavailable');
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
        'application/octet-stream',
    },
  );

  const url = await ctx.storage.getUrl(componentStorageId as Id<'_storage'>);
  if (!url) throw new ConvexError('Stored file URL is unavailable');
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
    storageId: v.id('_storage'),
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
    phase: v.union(v.literal('start'), v.literal('complete')),
    filename: v.optional(v.string()),
    mediaType: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
    sha256: v.optional(v.string()),
  },
  handler: async (ctx, { phase, filename, mediaType, mimeType, storageId, sha256 }) => {
    if (phase === 'start') {
      const uploadUrl = await ctx.storage.generateUploadUrl();
      return { uploadUrl };
    }

    if (!storageId) throw new ConvexError('storageId is required');
    if (!filename) throw new ConvexError('filename is required');
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
    await ctx.storage.delete(args_0.fileId as Id<'_storage'>);
  },
});
