import _ollama from 'ollama';
import { ollama } from 'ollama-ai-provider';
import type { LanguageModel } from 'ai';

export const MODEL_NAME = 'llama3.2';
export const llama3_2: LanguageModel = ollama(MODEL_NAME, {
  structuredOutputs: true,
});

export const model: LanguageModel = llama3_2;

export async function getEmbedding(input: string): Promise<number[]> {
  const { embeddings } = await _ollama.embed({
    model: 'nomic-embed-text:latest',
    input,
  });
  return embeddings[0] || [];
}
