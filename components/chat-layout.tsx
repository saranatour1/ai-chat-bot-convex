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
import { Dialog } from '@radix-ui/react-dialog';
import { useAction, useMutation } from 'convex/react';
import { CopyIcon, GlobeIcon, Loader, RefreshCcwIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Dispatch, Fragment, SetStateAction, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalStorage } from 'usehooks-ts';
import { Actions } from './ai-elements/actions';
import { Conversation, ConversationContent, ConversationScrollButton } from './ai-elements/conversation';
import { Message, MessageContent } from './ai-elements/message';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './ai-elements/reasoning';
import { Response } from './ai-elements/response';
import { Source, Sources, SourcesContent, SourcesTrigger } from './ai-elements/sources';
import { ChatHeader } from './chat-header';

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

  const sendMessage = useMutation(api.agent.index.streamMessageAsynchronously).withOptimisticUpdate((store, args) => {
    if (!args.threadId) return;
    optimisticallySendMessage(api.agent.index.viewThreadMessagesById)(store, {
      threadId: args.threadId,
      prompt: args.prompt,
    });
  });

  const { results: messages, status, loadMore, isLoading } = useUIMessages(
    api.agent.index.viewThreadMessagesById,
    threadId ? { threadId } : 'skip',
    { initialNumItems: 10, stream: true },
  );

  {/* type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error'; */ }
  {/* "pending" | "success" | "failed" |"streaming" */ }
  const runningMessageStatus = useMemo(() => {
    const lastMessage = messages?.[messages.length - 1];
    if (!lastMessage) return undefined;

    const status = lastMessage?.status === "pending" ? 'submitted' : lastMessage?.status === "failed" ? "error" : lastMessage?.status === "success" ? "ready" : lastMessage?.status === "streaming" ? "streaming" : 'submitted'
    return status
  }, [messages])

  const handleSubmit = useCallback(async (message: PromptInputMessage) => {
    if (runningMessageStatus === "streaming") {
      return void stopAction({ threadId })
    }
    try {
      const hasText = Boolean(message.text);
      const hasAttachments = Boolean(message.files?.length);

      if (!(hasText || hasAttachments)) {
        return;
      }
      const chatId = threadId || await createEmptyThread();

      if (!chatId) {
        console.error('Thread ID is undefined.');
        return;
      }

      router.push(`/chat/${chatId}`);

      // console.log(attachments) // here its empty
      await sendMessage({
        prompt: message.text || 'Sent with attachments',
        threadId: chatId,
        fileIds: attachments[0] ? attachments[0].fileId : undefined
      });

      setInput('');
      setAttachments([]);
      setLocalStorageInput('');
    } catch (e) {
      console.error(e)
    }
  }, [threadId, attachments, sendMessage, setAttachments, setInput, setLocalStorageInput,])

  useEffect(() => {
    if (!input && localStorageInput) {
      setInput(localStorageInput);
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
                        <Dialog>
                          {message && message.role === 'assistant' && i === messages.length - 1 ? (
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
                          ) : null}
                        </Dialog>
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
                  // case 'dynamic-tool':
                  //   const toolCall = message.parts.find(part => part.type === 'dynamic-tool');
                  //   return (
                  //       <div style={{ height: '500px' }}>
                  //     <Tool>
                  //       <ToolHeader type={toolCall.type} state={toolCall.state} />
                  //       <ToolContent>
                  //         <ToolInput input={toolCall.input} />
                  //         {toolCall.state === 'output-available' && (
                  //           <ToolOutput errorText={toolCall.errorText} output={toolCall.output} />
                  //         )}
                  //       </ToolContent>
                  //     </Tool>
                  //   </div>
                  //   )
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
          <TempChat setAttachments={setAttachments} />
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
          {/* type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error'; */}
          {/* "pending" | "success" | "failed" |"streaming" */}
          <PromptInputSubmit disabled={!input && !status} status={runningMessageStatus} />
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
  setAttachments: Dispatch<SetStateAction<File[]>>
}

const TempChat = ({ setAttachments }: TempChatProps) => {
  const { fileInputRef } = usePromptInputAttachments();
  const uploadFile = useAction(api.agent.index.uploadFile);


  useEffect(() => {
    const handleUploadingFiles = async (e: Event) => {
      // console.log("I've been called")
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      const filesFromRef = Array.from(target.files || []);

      if (!filesFromRef.length) {
        console.log("No files to upload");
        return;
      }

      try {
        const uploadedFiles = await Promise.all(
          filesFromRef.map(async (file) => {
            const startUpload = await uploadFile({ phase: "start" } as any) as { uploadUrl?: string };
            if (!startUpload?.uploadUrl) {
              throw new Error("Failed to create upload URL");
            }

            const uploadResponse = await fetch(startUpload.uploadUrl, {
              method: "POST",
              headers: {
                "Content-Type": file.type || "application/octet-stream",
              },
              body: file,
            });

            if (!uploadResponse.ok) {
              throw new Error(`Upload failed with status ${uploadResponse.status}`);
            }

            const { storageId } = await uploadResponse.json() as { storageId: string };
            if (!storageId) {
              throw new Error("Upload did not return a storageId");
            }

            const completeUpload = await uploadFile({
              phase: "complete",
              storageId,
              filename: file.name,
              mimeType: file.type || "application/octet-stream",
            } as any) as { fileId?: string; url?: string };
            if (!completeUpload.fileId || !completeUpload.url) {
              throw new Error("File registration failed");
            }

            return {
              fileId: completeUpload.fileId,
              url: completeUpload.url,
            };
          })
        );

        setAttachments(uploadedFiles);
        // console.log("Uploaded files:", uploadedFiles);
        return uploadedFiles;
      } catch (error) {
        console.error("Error uploading files:", error);
        throw error;
      }
    }
    const input = fileInputRef.current;
    if (!input) return;

    const handleChange = (e: Event) => {
      void handleUploadingFiles(e);
    };
    input.addEventListener('change', handleChange);

    return () => {
      input.removeEventListener('change', handleChange);
    };
  }, [fileInputRef, setAttachments])

  return <PromptInputAttachments>
    {(attachment) => <PromptInputAttachment data={attachment} />}
  </PromptInputAttachments>
}
