import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from 'ai';
import { google } from '@ai-sdk/google';
import { isTestEnvironment } from '../constants';

const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL ?? 'gemini-2.5-flash';
const GEMINI_REASONING_MODEL =
  process.env.GEMINI_REASONING_MODEL ?? 'gemini-2.5-pro';
const GEMINI_TITLE_MODEL =
  process.env.GEMINI_TITLE_MODEL ?? 'gemini-2.5-flash-lite';
const GEMINI_ARTIFACT_MODEL =
  process.env.GEMINI_ARTIFACT_MODEL ?? 'gemini-2.5-flash';
const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';

export const myProvider = isTestEnvironment
  ? customProvider({
      // languageModels: {
      //   'chat-model': chatModel,
      //   'chat-model-reasoning': reasoningModel,
      //   'title-model': titleModel,
      //   'artifact-model': artifactModel,
      // },
    })
  : customProvider({
      languageModels: {
        'chat-model': google.chat(GEMINI_CHAT_MODEL),
        'chat-model-reasoning': wrapLanguageModel({
          model: google.chat(GEMINI_REASONING_MODEL),
          middleware: extractReasoningMiddleware({ tagName: 'think' }),
        }),
        'title-model': google.chat(GEMINI_TITLE_MODEL),
        'artifact-model': google.chat(GEMINI_ARTIFACT_MODEL),
      },
      imageModels: {
        'small-model': google.image(GEMINI_IMAGE_MODEL),
      },
    });
