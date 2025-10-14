'use client'
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputMessage,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
  usePromptInputAttachments
} from '@/components/ai-elements/prompt-input';
import { api } from '@/convex/_generated/api';
import { optimisticallySendMessage, useUIMessages } from "@convex-dev/agent/react";
import { Action } from '@radix-ui/react-alert-dialog';
import { useAction, useMutation } from 'convex/react';
import { CopyIcon, GlobeIcon, Loader, RefreshCcwIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useLocalStorage } from 'usehooks-ts';
import { Actions } from './ai-elements/actions';
import { Conversation, ConversationContent, ConversationScrollButton } from './ai-elements/conversation';
import { Message, MessageContent } from './ai-elements/message';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './ai-elements/reasoning';
import { Response } from './ai-elements/response';
import { Source, Sources, SourcesContent, SourcesTrigger } from './ai-elements/sources';
import { ChatHeader } from './chat-header';
import { Id } from '@/convex/_generated/dataModel';

const models = [
  {
    name: 'GPT 4o',
    value: 'openai/gpt-4o',
  },
  {
    name: 'Deepseek R1',
    value: 'deepseek/deepseek-r1',
  },
];


export const ChatLayout = ({ threadId }: { threadId: string }) => {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [model, setModel] = useState<string>(models[0].value);
  const [webSearch, setWebSearch] = useState(false);
  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    'input',
    '',
  );
  const router = useRouter()

  const createEmptyThread = useMutation(api.agent.index.createEmptyThread)
  const stopAction = useAction(api.agent.index.stopStreaming)

  // const { messages, sendMessage, status, regenerate } = useChat();
  const sendMessage = useMutation(api.agent.index.streamMessageAsynchronously).withOptimisticUpdate((store, args) => {
    if (!args.threadId) return;
    optimisticallySendMessage(api.agent.index.viewThreadMessagesById)
  }
  );

  const { results: messages, status, loadMore, isLoading } = useUIMessages(
    api.agent.index.viewThreadMessagesById,
    threadId ? { threadId } : 'skip',
    { initialNumItems: 10, stream: true },
  );

  const handleSubmit = useCallback(async (message: PromptInputMessage) => {
    try {
      const hasText = Boolean(message.text);
      const hasAttachments = Boolean(message.files?.length);

      if (!(hasText || hasAttachments)) {
        return;
      }
      const chatId = threadId ? threadId : await createEmptyThread();

      if (!chatId) {
        console.error('Thread ID is undefined.');
        return;
      }
      router.push(`/chat/${chatId}`);

      sendMessage({
        prompt: message.text || 'Sent with attachments',
        threadId: threadId,
        // fileId
      },
      );
      setInput('');
      setAttachments([]);
      setLocalStorageInput('');
      setInput('');
    } catch (e) {
      console.error(e)
    }
  }, [threadId])


  useEffect(() => {
    if (input) {
      const finalValue = input || localStorageInput || '';
      setInput(finalValue);
    }
  }, []);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  return <div className="max-w-4xl mx-auto p-6 relative size-full h-screen">
    <div className="flex flex-col h-full">
      <ChatHeader chatId={threadId} isReadonly selectedModelId='' />
      <Conversation className="h-full">
        <ConversationContent>
          {messages.map((message) => (
            <div key={message.id}>
              {message.role === 'assistant' && message.parts.filter((part) => part.type === 'source-url').length > 0 && (
                <Sources>
                  <SourcesTrigger
                    count={
                      message.parts.filter(
                        (part) => part.type === 'source-url',
                      ).length
                    }
                  />
                  {message.parts.filter((part) => part.type === 'source-url').map((part, i) => (
                    <SourcesContent key={`${message.id}-${i}`}>
                      <Source
                        key={`${message.id}-${i}`}
                        href={part.url}
                        title={part.url}
                      />
                    </SourcesContent>
                  ))}
                </Sources>
              )}
              {message.parts.map((part, i) => {
                switch (part.type) {
                  case 'text':
                    return (
                      <Fragment key={`${message.id}-${i}`}>
                        <Message from={message.role}>
                          <MessageContent>
                            <Response>
                              {part.text}
                            </Response>
                          </MessageContent>
                        </Message>
                        {message.role === 'assistant' && i === messages.length - 1 && (
                          <Actions className="mt-2">
                            <Action
                            // onClick={() => regenerate()}
                            // label="Retry"
                            >
                              <RefreshCcwIcon className="size-3" />
                            </Action>
                            <Action
                              onClick={() =>
                                navigator.clipboard.writeText(part.text)
                              }
                            // label="Copy"
                            >
                              <CopyIcon className="size-3" />
                            </Action>
                          </Actions>
                        )}
                      </Fragment>
                    );
                  case 'reasoning':
                    return (
                      <Reasoning
                        key={`${message.id}-${i}`}
                        className="w-full"
                        isStreaming={messages?.[0]?.status === 'streaming' && i === message.parts.length - 1 && message.id === messages.at(-1)?.id}
                      >
                        <ReasoningTrigger />
                        <ReasoningContent>{part.text}</ReasoningContent>
                      </Reasoning>
                    );
                  default:
                    return null;
                }
              })}
            </div>
          ))}
          {messages?.[0]?.status === 'pending' && <Loader />}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>



      <PromptInput onSubmit={handleSubmit} className="mt-4" globalDrop maxFiles={1} multiple={false}>
        <PromptInputBody>
          <TempChat attachments={attachments} setAttachments={setAttachments} />
          <PromptInputTextarea
            onChange={(e) => setInput(e.target.value)}
            value={input}
          />
        </PromptInputBody>
        <PromptInputToolbar>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
            <PromptInputButton
              variant={webSearch ? 'default' : 'ghost'}
              onClick={() => setWebSearch(!webSearch)}
            >
              <GlobeIcon size={16} />
              <span>Search</span>
            </PromptInputButton>
            <PromptInputModelSelect
              onValueChange={(value) => {
                setModel(value);
              }}
              value={model}
            >
              <PromptInputModelSelectTrigger>
                <PromptInputModelSelectValue />
              </PromptInputModelSelectTrigger>
              <PromptInputModelSelectContent>
                {models.map((model) => (
                  <PromptInputModelSelectItem key={model.value} value={model.value}>
                    {model.name}
                  </PromptInputModelSelectItem>
                ))}
              </PromptInputModelSelectContent>
            </PromptInputModelSelect>
          </PromptInputTools>
          <PromptInputSubmit disabled={!input && !status} />
        </PromptInputToolbar>
      </PromptInput>


    </div>
  </div>
}

type File = {
  url: string;
  fileId: string;
};

interface TempChatProps {
  attachments: File[],
  setAttachments: (f: File[]) => void;
}

const TempChat = ({ attachments, setAttachments }: TempChatProps) => {
  const { add, remove, clear, files, fileInputRef } = usePromptInputAttachments();
  const uploadFile = useAction(api.agent.index.uploadFile);

  
  useEffect(()=>{
    const handleUploadingFiles = async (e: any) => {
      console.log("I've been called")
      const target = e.target as HTMLInputElement;
      const filesFromRef = Array.from(target.files || []);
  
      if (!filesFromRef.length) {
        console.log("No files to upload");
        return;
      }
  
      try {
        const uploadedFiles = await Promise.all(
          filesFromRef.map(async (file) => {
            const bytes = await file.arrayBuffer();
  
            const { fileId, url, storageId } = await uploadFile({
              filename: file.name,
              mimeType: file.type,
              bytes: bytes,
              // sha256:file.
            })
  
            return {
              fileId: fileId,
              url: url,
            };
          })
        );
  
        setAttachments(uploadedFiles)
        console.log("Uploaded files:", uploadedFiles);
        return uploadedFiles;
      } catch (error) {
        console.error("Error uploading files:", error);
        throw error;
      }
    }
    fileInputRef.current?.addEventListener('change', (e)=>{
      handleUploadingFiles(e)
    })

    return fileInputRef.current?.removeEventListener('change', (e)=>{
      handleUploadingFiles(e)
    })
  },[fileInputRef, attachments,setAttachments])
  return <PromptInputAttachments>
    {(attachment) => <PromptInputAttachment data={attachment} />}
  </PromptInputAttachments>
}