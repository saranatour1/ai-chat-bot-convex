'use client';

import { ChatHeader } from '@/components/chat-header';
import { api } from '@/convex/_generated/api';
import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { Messages } from './messages';
import { MultimodalInput } from './multimodal-input';

import {
  optimisticallySendMessage,
  toUIMessages,
  useThreadMessages
} from "@convex-dev/agent/react";
import { Attachment } from './preview-attachment';

export function Chat({ chatId }: {
  chatId: string;
}) {
  const [input, setInput] = useState<string>("")
  const thread = useQuery(api.agent.index.getThreadById, chatId && chatId !== undefined ? { threadId: chatId } : "skip")

  const messages = useThreadMessages(api.agent.index.viewThreadMessagesById,
    chatId ? { threadId: chatId } : "skip",
    { initialNumItems: 50, stream: true })

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);

  const sendMessage = useMutation(
    api.agent.index.streamMessageAsynchronously,
  ).withOptimisticUpdate((store,args)=>{
    if(!args.threadId) return;
    optimisticallySendMessage(api.agent.index.viewThreadMessagesById)
  }
  );

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

          <MultimodalInput
            chatId={chatId}
            input={input}
            setInput={setInput}
            handleSubmit={sendMessage}
            attachments={attachments}
            setAttachments={setAttachments}
            messages={toUIMessages(messages.results)}
            selectedVisibilityType={"private"}
          />

        </form>
      </div>

      {/* <Artifact
        chatId={chatId}
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
      /> */}
    </>
  );
}
