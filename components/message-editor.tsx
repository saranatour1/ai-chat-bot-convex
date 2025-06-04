'use client';
import type { UIMessage } from '@convex-dev/agent/react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { deleteTrailingMessages } from '@/app/(chat)/actions';
import { useEffect, useRef, useState } from 'react';


export function MessageEditor({
  message,
  setMode,
}:{message:UIMessage, setMode:(mode:"edit"|"view")=>void}) {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [draftContent, setDraftContent] = useState<string>(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, []);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight + 2}px`;
    }
  };

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraftContent(event.target.value);
    adjustHeight();
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <Textarea
        data-testid="message-editor"
        ref={textareaRef}
        className="bg-transparent outline-hidden overflow-hidden resize-none text-base! rounded-xl w-full"
        value={draftContent}
        onChange={handleInput}
      />

      <div className="flex flex-row gap-2 justify-end">
        <Button
          variant="outline"
          className="h-fit py-2 px-3"
          onClick={() => {
            setMode('view');
          }}
        >
          Cancel
        </Button>
        <Button
          data-testid="message-editor-send-button"
          variant="default"
          className="h-fit py-2 px-3"
          disabled={isSubmitting}
          onClick={async () => {
            setIsSubmitting(true);

            await deleteTrailingMessages({
              id: message.id,
            });

            // setMessages((messages) => {
            //   const index = messages.findIndex((m:UIMessage) => m.id === message.id);

            //   if (index !== -1) {
            //     const updatedMessage = {
            //       ...message,
            //       content: draftContent,
            //       parts: [{ type: 'text', text: draftContent }],
            //     };

            //     return [...messages.slice(0, index), updatedMessage];
            //   }

            //   return messages;
            // });

            setMode('view');
          }}
        >
          {isSubmitting ? 'Sending...' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
