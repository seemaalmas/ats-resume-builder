import { MockLlmProvider } from './mock-llm';
import type { LlmProvider } from './llm-provider';

export function getLlmProvider(): LlmProvider {
  const provider = process.env.LLM_PROVIDER || 'mock';
  if (provider === 'mock') {
    return new MockLlmProvider();
  }
  return new MockLlmProvider();
}
