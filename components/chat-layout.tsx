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
import type { Id } from '@/convex/_generated/dataModel';
import { optimisticallySendMessage, useUIMessages } from "@convex-dev/agent/react";
import { useAction, useMutation, useQuery } from 'convex/react';
import { CopyIcon, GlobeIcon, Loader, RefreshCcwIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Dispatch, Fragment, SetStateAction, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalStorage } from 'usehooks-ts';
import { Action, Actions } from './ai-elements/actions';
import { Conversation, ConversationContent, ConversationScrollButton } from './ai-elements/conversation';
import { Message, MessageContent } from './ai-elements/message';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './ai-elements/reasoning';
import { Response } from './ai-elements/response';
import { Source, Sources, SourcesContent, SourcesTrigger } from './ai-elements/sources';
import { ChatHeader } from './chat-header';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const models = [
  {
    name: 'Gemini 2.5 Flash',
    value: 'google/gemini-2.5-flash',
  },
  {
    name: 'Gemini 2.5 Pro',
    value: 'google/gemini-2.5-pro',
  },
];
const TOOL_CALLS_PER_DAY_LIMIT = 3;
type GoogleSearchMode = 'MODE_DYNAMIC' | 'MODE_UNSPECIFIED';
type UrlContextPreference = 'auto' | 'off' | 'on';
type ToolInputsPayload = {
  google_search?: {
    enabled?: boolean;
    mode?: GoogleSearchMode;
    dynamicThreshold?: number;
  };
  url_context?: {
    enabled?: boolean;
  };
};

const normalizeDynamicThreshold = (rawValue: string) => {
  const parsed = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.min(1, Math.max(0, parsed));
};

type SourcePart = {
  type: string;
};

type SourceUrlPart = SourcePart & {
  type: 'source-url';
  sourceId?: string;
  title?: string;
  url: string;
};

type SourceDocumentPart = SourcePart & {
  filename?: string;
  mediaType?: string;
  sourceId?: string;
  title?: string;
  type: 'source-document';
};

type NormalizedSource = {
  href?: string;
  key: string;
  kind: 'document' | 'url';
  sourceId?: string;
  subtitle: string;
  title: string;
};

const isSourceUrlPart = (part: SourcePart): part is SourceUrlPart =>
  part.type === 'source-url';

const isSourceDocumentPart = (part: SourcePart): part is SourceDocumentPart =>
  part.type === 'source-document';

const getHostnameFromUrl = (value: string) => {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
};

const buildSourceDedupeKey = (sourceId: string | undefined, fallback: string) => {
  const normalizedSourceId = sourceId?.trim();
  if (normalizedSourceId) {
    return `source-id:${normalizedSourceId}`;
  }
  return `fallback:${fallback}`;
};

const normalizeMessageSources = (parts: ReadonlyArray<SourcePart>) => {
  const deduped = new Map<string, NormalizedSource>();

  for (const part of parts) {
    if (isSourceUrlPart(part)) {
      const hostname = getHostnameFromUrl(part.url);
      const title = part.title?.trim() || hostname || part.url;
      const subtitle = hostname || 'Web source';
      const dedupeKey = buildSourceDedupeKey(part.sourceId, part.url);

      if (!deduped.has(dedupeKey)) {
        deduped.set(dedupeKey, {
          key: dedupeKey,
          kind: 'url',
          sourceId: part.sourceId,
          title,
          subtitle,
          href: part.url,
        });
      }
      continue;
    }

    if (isSourceDocumentPart(part)) {
      const title = part.title?.trim() || part.filename || 'Document source';
      const subtitle = part.filename || part.mediaType || 'Document source';
      const fallback = part.filename || part.title || part.mediaType || title;
      const dedupeKey = buildSourceDedupeKey(part.sourceId, fallback);

      if (!deduped.has(dedupeKey)) {
        deduped.set(dedupeKey, {
          key: dedupeKey,
          kind: 'document',
          sourceId: part.sourceId,
          title,
          subtitle,
        });
      }
    }
  }

  return [...deduped.values()];
};

export const ChatLayout = ({ threadId }: { threadId: string }) => {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [model, setModel] = useState<string>(models[0].value);
  const [webSearch, setWebSearch] = useState(false);
  const [googleSearchMode, setGoogleSearchMode] = useState<GoogleSearchMode>('MODE_UNSPECIFIED');
  const [googleSearchDynamicThreshold, setGoogleSearchDynamicThreshold] = useState<string>('1');
  const [urlContextPreference, setUrlContextPreference] = useState<UrlContextPreference>('auto');
  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    'input',
    '',
  );
  const router = useRouter()
  const toolRateLimit = useQuery(api.agent.index.getToolCallRateLimitStatus);
  const remainingToolCalls = toolRateLimit?.remaining ?? TOOL_CALLS_PER_DAY_LIMIT;
  const isSearchToolDisabled = remainingToolCalls <= 0;

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
      const searchEnabled = webSearch && !isSearchToolDisabled;
      const requestedTools = searchEnabled ? ['google_search'] : [];
      const dynamicThreshold = normalizeDynamicThreshold(googleSearchDynamicThreshold);
      const urlContextEnabled = urlContextPreference === 'auto'
        ? undefined
        : urlContextPreference === 'on';
      const toolInputs: ToolInputsPayload = {
        google_search: {
          enabled: searchEnabled,
          mode: googleSearchMode,
          ...(dynamicThreshold !== undefined ? { dynamicThreshold } : {}),
        },
        url_context: {
          ...(urlContextEnabled !== undefined ? { enabled: urlContextEnabled } : {}),
        },
      };

      await sendMessage({
        prompt: message.text || 'Sent with attachments',
        threadId: chatId,
        fileIds: attachments[0] ? attachments[0].fileId : undefined,
        body: {
          model,
          tools: requestedTools,
          toolInputs,
        },
      });

      setInput('');
      setAttachments([]);
      setLocalStorageInput('');
    } catch (e) {
      console.error(e)
    }
  }, [threadId, attachments, model, webSearch, googleSearchDynamicThreshold, googleSearchMode, urlContextPreference, isSearchToolDisabled, sendMessage, setAttachments, setInput, setLocalStorageInput,])

  useEffect(() => {
    if (!input && localStorageInput) {
      setInput(localStorageInput);
    }
  }, []);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  useEffect(() => {
    if (isSearchToolDisabled && webSearch) {
      setWebSearch(false);
    }
  }, [isSearchToolDisabled, webSearch]);

  return <div className="max-w-4xl mx-auto p-6 relative size-full h-screen">
    <div className="flex flex-col h-full">
      <ChatHeader chatId={threadId} isReadonly selectedModelId='' />
      <Conversation className="h-full">
        <ConversationContent>
          {messages.map((message) => {
            const normalizedSources = message.role === 'assistant'
              ? normalizeMessageSources(message.parts as ReadonlyArray<SourcePart>)
              : [];

            return (
              <div key={message.id}>
                {normalizedSources.length > 0 && (
                  <Sources>
                    <SourcesTrigger count={normalizedSources.length} />
                    <SourcesContent>
                      {normalizedSources.map((source) => (
                        <Source
                          key={`${message.id}-${source.key}`}
                          href={source.href}
                          subtitle={source.subtitle}
                          title={source.title}
                        />
                      ))}
                    </SourcesContent>
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
            );
          })}
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
              <PromptInputActionMenuContent className="w-64">
                <PromptInputActionAddAttachments />
                <div className="my-1 h-px bg-border" />
                <div className="space-y-2 px-2 py-1">
                  <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                    Tool settings
                  </p>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">URL context</p>
                    <Select
                      onValueChange={(value) =>
                        setUrlContextPreference(value as UrlContextPreference)
                      }
                      value={urlContextPreference}
                    >
                      <SelectTrigger className="h-8 w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start">
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="on">On</SelectItem>
                        <SelectItem value="off">Off</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Search mode</p>
                    <Select
                      disabled={!webSearch || isSearchToolDisabled}
                      onValueChange={(value) =>
                        setGoogleSearchMode(value as GoogleSearchMode)
                      }
                      value={googleSearchMode}
                    >
                      <SelectTrigger className="h-8 w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start">
                        <SelectItem value="MODE_UNSPECIFIED">Always retrieve</SelectItem>
                        <SelectItem value="MODE_DYNAMIC">Dynamic retrieve</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Search threshold (0 to 1)
                    </p>
                    <Input
                      className="h-8 text-xs"
                      disabled={!webSearch || isSearchToolDisabled}
                      max={1}
                      min={0}
                      onBlur={(event) => {
                        const normalized = normalizeDynamicThreshold(event.currentTarget.value);
                        setGoogleSearchDynamicThreshold(
                          normalized === undefined ? '1' : normalized.toString(),
                        );
                      }}
                      onChange={(event) =>
                        setGoogleSearchDynamicThreshold(event.currentTarget.value)
                      }
                      step={0.05}
                      type="number"
                      value={googleSearchDynamicThreshold}
                    />
                  </div>
                </div>
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
            <PromptInputButton
              variant={webSearch ? 'default' : 'ghost'}
              disabled={isSearchToolDisabled}
              onClick={() => setWebSearch(!webSearch)}
            >
              <GlobeIcon size={16} />
              <span>Search ({remainingToolCalls}/3)</span>
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
  const startFileUpload = useAction(api.agent.index.startFileUpload);
  const completeFileUpload = useAction(api.agent.index.completeFileUpload);


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
            const startUpload = await startFileUpload({});
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

            const uploadPayload = await uploadResponse.json() as { storageId?: string };
            if (!uploadPayload.storageId || typeof uploadPayload.storageId !== "string") {
              throw new Error("Upload did not return a storageId");
            }
            const storageId = uploadPayload.storageId as Id<"_storage">;

            const completeUpload = await completeFileUpload({
              storageId,
              filename: file.name,
              mediaType: file.type || "application/octet-stream",
            });
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
