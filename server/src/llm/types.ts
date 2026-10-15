export type LLMRole = 'system' | 'user' | 'assistant';
export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface CompleteOptions {
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for a JSON object (OpenAI-style response_format). */
  json?: boolean;
  signal?: AbortSignal;
}

/**
 * Everything above this interface is provider-agnostic.
 * Adding a provider = one new class; nothing else changes.
 * (Tool calling gets added here in the agent slice.)
 */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(messages: LLMMessage[], options?: CompleteOptions): Promise<string>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
