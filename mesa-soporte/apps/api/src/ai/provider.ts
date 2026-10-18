import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '../common/errors';

export interface AiRequest {
  system: string;
  user: string;
  /** JSON schema of the expected answer (structured output). */
  schema?: Record<string, unknown>;
  maxTokens: number;
}

export interface AiProvider {
  complete(r: AiRequest): Promise<{ text: string; model: string }>;
}

/**
 * Claude through the Anthropic API (section 5.12: the account must have
 * zero data retention; nothing is used for training). A request the model
 * declines is re-run server-side on Anthropic's recommended fallback model.
 */
export class AnthropicAiProvider implements AiProvider {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    fetchImpl?: typeof fetch,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2, fetch: fetchImpl });
  }

  async complete(r: AiRequest): Promise<{ text: string; model: string }> {
    let res;
    try {
      res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: r.maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: r.system, cache_control: { type: 'ephemeral' } }],
        output_config: {
          effort: 'medium',
          ...(r.schema ? { format: { type: 'json_schema', schema: r.schema } } : {}),
        },
        messages: [{ role: 'user', content: r.user }],
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError)
        throw new AppError('rate_limited', 'The AI service is busy; try again shortly.');
      if (err instanceof Anthropic.APIError)
        throw new AppError('conflict', `The AI service failed (HTTP ${err.status ?? '?'}).`);
      throw err;
    }
    if (res.stop_reason === 'refusal')
      throw new AppError('conflict', 'The AI declined this request.');
    const text = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    return { text, model: res.model };
  }
}
