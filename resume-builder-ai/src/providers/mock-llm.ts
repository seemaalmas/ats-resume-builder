import type { LlmCompletionRequest, LlmCompletionResponse, LlmProvider } from './llm-provider';

export class MockLlmProvider implements LlmProvider {
  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const userContent = request.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n');

    const content = `Mock response for model ${request.model}. Input length: ${userContent.length}.`;
    return { content };
  }
}
