
import { LoaderIcon } from './icons';

export type Attachment = { url:string, fileId:string};
export const PreviewAttachment = ({
  attachment,
  isUploading = false,
}: {
  attachment: Attachment;
  isUploading?: boolean;
}) => {
  const { url, fileId } = attachment;

  return (
    <div data-testid="input-attachment-preview" className="flex flex-col gap-2">
      <div className="w-20 h-16 aspect-video bg-muted rounded-md relative flex flex-col items-center justify-center">

            <img
              key={url}
              src={url}
              alt={fileId ?? 'An image attachment'}
              className="rounded-md size-full object-cover"
            />

        {isUploading && (
          <div
            data-testid="input-attachment-loader"
            className="animate-spin absolute text-zinc-500"
          >
            <LoaderIcon />
          </div>
        )}
      </div>
      <div className="text-xs text-zinc-500 max-w-16 truncate">{fileId}</div>
    </div>
  );
};
