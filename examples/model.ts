import 'dotenv/config';

import { ollama } from 'ai-sdk-ollama';
import { embed } from 'ai';
import { mistral } from '@ai-sdk/mistral';
import { groq } from '@ai-sdk/groq';

// Ollama models (local, no API key required)
export const MODEL_NAME = 'llama3.2';
export const llama3_2 = ollama(MODEL_NAME, {
  structuredOutputs: true,
});

// Groq model (requires GROQ_API_KEY)
export const groqModel = groq('openai/gpt-oss-20b');

// Mistral model (requires MISTRAL_API_KEY)
export const mistralModel = mistral('mistral-small-latest');

// Default model for text generation
export const model = mistralModel;

export async function getEmbedding(input: string) {
  const { embedding } = await embed({
    model: 'nomic-embed-text:latest',
    value: input,
  });
  return embedding;
}
