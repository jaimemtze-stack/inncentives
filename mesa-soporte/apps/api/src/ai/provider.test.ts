import { describe, expect, it } from 'vitest';
import { AnthropicAiProvider } from './provider';

function fakeApi(reply: Record<string, unknown>) {
  const seen: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { f, seen };
}

const message = (extra: Record<string, unknown>) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text: 'Hola' }],
  stop_reason: 'end_turn',
  stop_details: null,
  usage: { input_tokens: 10, output_tokens: 2 },
  ...extra,
});

describe('AnthropicAiProvider', () => {
  it('sends the model, effort, refusal fallback and structured output', async () => {
    const { f, seen } = fakeApi(message({}));
    const p = new AnthropicAiProvider('sk-test', 'claude-opus-5-5', f);
    const r = await p.complete({
      system: 'sys',
      user: 'texto',
      maxTokens: 1000,
      schema: { type: 'object', properties: {}, additionalProperties: false },
    });
    expect(r).toEqual({ text: 'Hola', model: 'claude-opus-5-5' });
    expect(seen[0]!.url).toMatch(/\/v1\/messages\?beta=true$/);
    expect(seen[0]!.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(seen[0]!.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1000,
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
      messages: [{ role: 'user', content: 'texto' }],
    });
    expect(seen[0]!.body).not.toHaveProperty('thinking');
  });

  it('turns a refusal into an error instead of an empty suggestion', async () => {
    const { f } = fakeApi(
      message({
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: null },
      }),
    );
    await expect(
      new AnthropicAiProvider('sk-test', 'claude-opus-5-5', f).complete({
        system: 's',
        user: 'u',
        maxTokens: 10,
      }),
    ).rejects.toThrow(/declined/);
  });
});
