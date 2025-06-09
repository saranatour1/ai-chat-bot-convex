'use client'
import { useMessages } from '@/hooks/use-messages';
import type { UIMessage } from '@convex-dev/agent/react';
import equal from 'fast-deep-equal';
import { motion } from 'framer-motion';
import { Fragment, memo } from 'react';
import { Greeting } from './greeting';
import { PreviewMessage, ThinkingMessage } from './message';

function PureMessages({ messages, chatId, status }: { status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted", chatId: string, messages: UIMessage[] }) {

  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    onViewportEnter,
    onViewportLeave,
    hasSentMessage,
  } = useMessages({
    chatId,
    status: "streaming" // This shouldn't be hard coded 
  });

  return (
    <div
      ref={messagesContainerRef}
      className="flex flex-col min-w-0 gap-6 flex-1 overflow-y-scroll pt-4 relative"
    >
      {messages.length === 0 && <Greeting />}

      {messages.map((message, index) => (
        <Fragment key={message.id}>
          <PreviewMessage
            chatId={chatId}
            message={message}
            isLoading={message.status === 'pending' && messages.length - 1 === index}
            requiresScrollPadding={
              hasSentMessage && index === messages.length - 1
            }
          />

          {message.status === "pending" &&
            messages.length > 0 &&
            messages[messages.length - 1].role === 'user' && <ThinkingMessage />}
        </Fragment>
      ))}


      <motion.div
        ref={messagesEndRef}
        className="shrink-0 min-w-[24px] min-h-[24px]"
        onViewportLeave={onViewportLeave}
        onViewportEnter={onViewportEnter}
      />
    </div>
  );
}

export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.status && nextProps.status) return false;
  if (prevProps.messages.length !== nextProps.messages.length) return false;
  if (!equal(prevProps.messages, nextProps.messages)) return false;
  return true;
});
