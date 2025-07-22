import _ollama from 'ollama';
import 'dotenv/config';

import { ollama } from 'ollama-ai-provider';

export const MODEL_NAME = 'llama3.2';
// export const llama3_2: LanguageModel = ollama(MODEL_NAME, {
//   structuredOutputs: true,
// });

import { mistral } from '@ai-sdk/mistral';
import { openai } from '@ai-sdk/openai';

export const mistralModel = mistral('mistral-small-latest');
export const openaiModel = openai('gpt-4o-mini');

// Use Mistral for object generation (no API key required)
export const model = mistralModel;

export async function getEmbedding(input: string): Promise<number[]> {
  const { embeddings } = await _ollama.embed({
    model: 'nomic-embed-text:latest',
    input,
  });
  return embeddings[0] || [];
}
