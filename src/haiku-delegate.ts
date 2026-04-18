/**
 * haiku-delegate — reusable helper for tools that delegate a focused task to
 * Claude Haiku 4.5 via the Anthropic SDK.
 *
 * Pattern: one system prompt (frozen instructions), one or more large cached
 * input blocks (reused across reruns/siblings), a volatile "fresh" block for
 * per-call parameters, a Zod schema for structured output.
 *
 * The last cached block carries cache_control: {type: "ephemeral"} so the
 * entire system + cached prefix is cached as one unit. Reruns with identical
 * prefixes (same song's words.json + Genius lookup) pay ~0.1× input cost on
 * the cached portion.
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export interface CachedBlock {
  /** Short label shown as the block header ("Whisper words", "Genius lyrics", etc.) */
  label: string;
  /** The block's content — typically a JSON-stringified large object or raw text */
  content: string;
}

export interface HaikuCallParams<T> {
  /** Frozen instructions. Small. Rendered as the system prompt. */
  systemPrompt: string;
  /** Large inputs that are stable across reruns. The last one carries cache_control. */
  cachedBlocks: CachedBlock[];
  /** Per-call parameters (e.g. BPM values, thresholds). NOT cached. */
  freshBlock: string;
  /** Zod schema for the expected structured output. */
  schema: z.ZodType<T>;
  /** Max output tokens. Default 16000. */
  maxTokens?: number;
}

export interface HaikuCallResult<T> {
  parsed: T;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
}

export async function callHaiku<T>(params: HaikuCallParams<T>): Promise<HaikuCallResult<T>> {
  const { systemPrompt, cachedBlocks, freshBlock, schema, maxTokens = 16000 } = params;

  if (cachedBlocks.length === 0) {
    throw new Error("callHaiku requires at least one cached block");
  }

  const client = new Anthropic();

  const content: Anthropic.TextBlockParam[] = [];
  for (let i = 0; i < cachedBlocks.length; i++) {
    const { label, content: body } = cachedBlocks[i];
    const isLast = i === cachedBlocks.length - 1;
    content.push({
      type: "text",
      text: `### ${label}\n\n${body}`,
      // cache_control on the last cached block caches system + all prior blocks in one unit
      ...(isLast && { cache_control: { type: "ephemeral" } }),
    });
  }
  content.push({ type: "text", text: freshBlock });

  const response = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: maxTokens,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content }],
    output_config: {
      format: zodOutputFormat(schema, "result"),
    },
  });

  if (!response.parsed_output) {
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    const preview = textBlock?.text?.slice(0, 500) ?? "(no text block)";
    throw new Error(`Haiku did not return parseable output. Stop reason: ${response.stop_reason}. Preview: ${preview}`);
  }

  return {
    parsed: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}

/**
 * Format the usage object as a single-line summary for logging.
 */
export function formatUsage(u: HaikuCallResult<unknown>["usage"]): string {
  return `tokens: in=${u.inputTokens} out=${u.outputTokens} cache_write=${u.cacheCreationInputTokens} cache_read=${u.cacheReadInputTokens}`;
}
