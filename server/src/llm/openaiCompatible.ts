import { z } from 'zod';
import { LLMError, type CompleteOptions, type LLMMessage, type LLMProvider } from './types';

const ResponseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
});

/**
 * Talks to any `/chat/completions` endpoint (OpenAI, Gemini, Anthropic compat,
 * Groq, OpenRouter, Ollama). Plain fetch — no SDK — so you can see exactly
 * what goes over the wire.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = 'openai-compatible';

  constructor(
    private readonly config: { baseUrl: string; apiKey: string; model: string; timeoutMs?: number },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get model(): string {
    return this.config.model;
  }

  async complete(messages: LLMMessage[], options: CompleteOptions = {}): Promise<string> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 60_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: options.temperature ?? 0.3,
          ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
          ...(options.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal,
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : String(err);
      throw new LLMError(`Could not reach LLM provider at ${url}: ${reason}`);
    }

    const bodyText = await res.text();
    if (!res.ok) {
      // Provider error bodies are useful for debugging but never contain our key.
      throw new LLMError(`LLM provider returned ${res.status}: ${bodyText.slice(0, 500)}`, res.status);
    }

    let json: unknown;
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new LLMError('LLM provider returned non-JSON response');
    }
    const parsed = ResponseSchema.safeParse(json);
    if (!parsed.success) throw new LLMError('LLM provider response had an unexpected shape');

    const content = parsed.data.choices[0]?.message.content?.trim();
    if (!content) throw new LLMError('LLM provider returned an empty reply');
    return content;
  }
}
