'use client';

import { ChatHeader } from '@/components/chat-header';
import { api } from '@/convex/_generated/api';
import { useArtifactSelector } from '@/hooks/use-artifact';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import type { Attachment } from 'ai';
import { useQuery } from 'convex/react';
import { notFound, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Artifact } from './artifact';
import { Messages } from './messages';
import { MultimodalInput } from './multimodal-input';

import {
  toUIMessages,
  useThreadMessages
} from "@convex-dev/agent/react";

export function Chat({ chatId }: {
  chatId: string;
}) {

  const thread = useQuery(api.agent.index.getThreadById, chatId ? { threadId: chatId } : "skip")

  // if (!thread) {
  //   return notFound()
  // }


  const { visibilityType } = useChatVisibility({
    chatId: chatId,
    initialVisibilityType: "private",
  });

  const messages = useThreadMessages(api.agent.index.viewThreadMessagesById, {threadId:chatId}, {initialNumItems:50, stream:true})

  const searchParams = useSearchParams();
  const query = searchParams.get('query');

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);
  const [input, setInput] = useState()

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      // append({
      //   role: 'user',
      //   content: query,
      // });

      setHasAppendedQuery(true);
      window.history.replaceState({}, '', `/chat/${chatId}`);
    }
  }, [query, hasAppendedQuery, chatId]);


  const [attachments, setAttachments] = useState<Array<Attachment>>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  // useAutoResume({
  //   autoResume,
  //   initialMessages,
  //   experimental_resume,
  //   data,
  //   setMessages,
  // });
  return (
    <>
      <div className="flex flex-col min-w-0 h-dvh bg-background">
        <ChatHeader
          chatId={chatId}
          selectedModelId={""} // Todo: fix this some how
          selectedVisibilityType={"private"}
          isReadonly={false}
        />

        <Messages
          chatId={chatId}
          status={messages.status}
          messages={toUIMessages(messages.results)}
        />

        <form className="flex mx-auto px-4 bg-background pb-4 md:pb-6 gap-2 w-full md:max-w-3xl">
          {!false && (
            <MultimodalInput
              chatId={chatId}
              input={input}
              setInput={setInput}
              handleSubmit={handleSubmit}
              // status={messages.isLoading ? "submitted":"streaming"}
              stop={stop}
              attachments={attachments}
              setAttachments={setAttachments}
              messages={messages}
              setMessages={setMessages}
              append={append}
              selectedVisibilityType={visibilityType}
            />
          )}
        </form>
      </div>

      <Artifact
        chatId={id}
        input={input}
        setInput={setInput}
        handleSubmit={handleSubmit}
        status={status}
        stop={stop}
        attachments={attachments}
        setAttachments={setAttachments}
        append={append}
        messages={messages}
        setMessages={setMessages}
        reload={reload}
        votes={votes}
        isReadonly={isReadonly}
        selectedVisibilityType={visibilityType}
      />
    </>
  );
}
