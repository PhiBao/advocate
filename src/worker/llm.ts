// Typed LLM client used by the extraction / findings / letter pipeline.
// Design rules:
// - No vendor SDK dependency: plain fetch, so providers are swappable.
// - Every structured call goes through `completeJson` with a caller-supplied
//   type guard. Unparseable or invalid output is retried, then surfaces as a
//   pipeline failure — never as silent garbage (see spec §11).
//
// Providers:
// - `createOpenAICompatClient` — any OpenAI-compatible gateway. Default config
//   points at DGrid (https://api.dgrid.ai/v1), which aggregates 200+ models
//   behind one key. Verified 2026-09-05: extraction-grade vision calls cost a
//   fraction of a cent (e.g. qwen/qwen2.5-vl-72b-instruct ≈ $0.0007/call).
// - `createAnthropicClient` — Anthropic direct API (fallback option).

export type Guard<T> = (value: unknown) => T;

export class LlmError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = "LlmError";
    this.retryable = retryable;
  }
}

export interface JsonCallOptions<T> {
  system: string;
  user: string;
  /** Vision input for extraction stages (data URLs or https URLs). */
  images?: string[];
  guard: Guard<T>;
  maxTokens?: number;
  /** Structured-output JSON Schema for providers that support it. Optional. */
  jsonSchema?: Record<string, unknown>;
}

export interface LlmClient {
  completeJson<T>(opts: JsonCallOptions<T>): Promise<T>;
}

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_ATTEMPTS = 2;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Extract the first {...} JSON object from a text response. */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new LlmError("Model response contained no JSON object.", true);
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    throw new LlmError("Model response contained malformed JSON.", true);
  }
}

function messageText(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data["choices"])) {
    throw new LlmError("Unexpected LLM response shape.", true);
  }
  const first = data["choices"][0];
  if (!isRecord(first) || !isRecord(first["message"])) {
    throw new LlmError("LLM response contained no message.", true);
  }
  const content = first["message"]["content"];
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(isRecord)
      .filter((b) => b["type"] === "text")
      .map((b) => String(b["text"] ?? ""))
      .join("");
  }
  throw new LlmError("LLM response contained no text.", true);
}

export interface OpenAICompatOptions {
  baseURL: string;
  apiKey: string;
  model: string;
}

/**
 * OpenAI-compatible chat client (DGrid gateway default).
 * Sends `response_format: json_object` first; if the routed model rejects it
 * (HTTP 400), retries once without it and falls back to JSON extraction.
 */
export function createOpenAICompatClient(opts: OpenAICompatOptions): LlmClient {
  const endpoint = `${opts.baseURL.replace(/\/$/, "")}/chat/completions`;

  async function call<T>(callOpts: JsonCallOptions<T>, useJsonMode: boolean): Promise<T> {
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: callOpts.user },
    ];
    for (const img of callOpts.images ?? []) {
      content.push({ type: "image_url", image_url: { url: img } });
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          {
            role: "system",
            content: `${callOpts.system}\n\nRespond with a single JSON object and nothing else.`,
          },
          { role: "user", content },
        ],
        max_tokens: callOpts.maxTokens ?? 4096,
        ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (res.status === 400 && useJsonMode) {
      // Routed model doesn't support json_object mode — retry without it.
      return call(callOpts, false);
    }
    if (!res.ok) {
      throw new LlmError(
        `LLM request failed with status ${res.status}.`,
        res.status === 429 || res.status >= 500,
      );
    }
    const data = (await res.json()) as unknown;
    return callOpts.guard(extractJsonObject(messageText(data)));
  }

  return {
    async completeJson<T>(callOpts: JsonCallOptions<T>): Promise<T> {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          return await call(callOpts, true);
        } catch (err) {
          lastError = err;
          if (err instanceof LlmError && !err.retryable) break;
        }
      }
      if (lastError instanceof Error) throw lastError;
      throw new LlmError("LLM request failed.", true);
    },
  };
}

export function createAnthropicClient(apiKey: string, model = ANTHROPIC_DEFAULT_MODEL): LlmClient {
  return {
    async completeJson<T>(opts: JsonCallOptions<T>): Promise<T> {
      const content: Array<Record<string, unknown>> = [];
      for (const img of opts.images ?? []) {
        const source = img.startsWith("data:")
          ? (() => {
              const m = /^data:([^;]+);base64,(.+)$/s.exec(img);
              if (!m) throw new LlmError("Invalid image data URL.", false);
              return { type: "base64", media_type: m[1], data: m[2] };
            })()
          : { type: "url", url: img };
        content.push({ type: "image", source });
      }
      content.push({ type: "text", text: opts.user });

      let lastError: unknown = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: opts.maxTokens ?? 4096,
            system: `${opts.system}\n\nRespond with a single JSON object and nothing else.`,
            messages: [{ role: "user", content }],
          }),
        });
        if (!res.ok) {
          const retryable = res.status === 429 || res.status >= 500;
          lastError = new LlmError(`LLM request failed with status ${res.status}.`, retryable);
          if (!retryable) break;
          continue;
        }
        const data = (await res.json()) as unknown;
        if (!isRecord(data) || !Array.isArray(data["content"])) {
          lastError = new LlmError("Unexpected LLM response shape.", true);
          continue;
        }
        const text = data["content"]
          .filter(isRecord)
          .filter((b) => b["type"] === "text")
          .map((b) => String(b["text"] ?? ""))
          .join("");
        try {
          const parsed = extractJsonObject(text);
          return opts.guard(parsed);
        } catch (err) {
          lastError = err;
        }
      }
      if (lastError instanceof Error) throw lastError;
      throw new LlmError("LLM request failed.", true);
    },
  };
}

/** Null client for local dev without a key: every call fails closed. */
export function createNullClient(): LlmClient {
  return {
    async completeJson<T>(): Promise<T> {
      throw new LlmError("No LLM provider configured (set LLM_API_KEY).", false);
    },
  };
}

/** Build the pipeline client from Worker env. Fails closed without a key. */
export function clientFromEnv(env: {
  LLM_API_KEY?: string;
  LLM_BASE_URL: string;
  LLM_MODEL: string;
}): LlmClient {
  if (!env.LLM_API_KEY) return createNullClient();
  return createOpenAICompatClient({
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL,
  });
}
