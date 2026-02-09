export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LlmCompletionRequest = {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
};

export type LlmCompletionResponse = {
  content: string;
};

export interface LlmProvider {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}
