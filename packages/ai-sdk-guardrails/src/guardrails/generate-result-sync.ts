/**
 * Keeps `text` and `content` aligned on V4 generate results.
 *
 * AI SDK v7 derives user-visible text from `content`, not the top-level `text`
 * field. Output guardrails that mutate only one field are otherwise silently ignored.
 */

import { z } from 'zod';

/** The text-bearing fields of a generate result, before they are parsed. */
interface TextResultFields {
  text?: unknown;
  content?: unknown;
}

export interface GenerateResultTextSnapshot {
  text?: string;
  contentJoined?: string;
}

const textSchema = z.string();

const textPartSchema = z.object({ type: z.literal('text'), text: z.string() });

function textOf(value: TextResultFields['text']): string | undefined {
  const parsed = textSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

function joinTextFromContent(
  content: TextResultFields['content'],
): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts = content.flatMap((part) => {
    const parsed = textPartSchema.safeParse(part);

    return parsed.success ? [parsed.data.text] : [];
  });

  return parts.length > 0 ? parts.join('') : undefined;
}

export function snapshotGenerateResultText(
  result: TextResultFields,
): GenerateResultTextSnapshot {
  return {
    text: textOf(result.text),
    contentJoined: joinTextFromContent(result.content),
  };
}

export function syncGenerateResultTextAfterGuardrails<
  T extends TextResultFields,
>(result: T, before: GenerateResultTextSnapshot): T {
  const record: TextResultFields = result;
  const afterContent = joinTextFromContent(record.content);
  const afterText = textOf(record.text);

  const textChanged = afterText !== undefined && afterText !== before.text;

  const contentChanged =
    afterContent !== undefined && afterContent !== before.contentJoined;

  if (textChanged && !contentChanged && afterText !== undefined) {
    record.content = [{ type: 'text', text: afterText }];
    record.text = afterText;

    return result;
  }

  if (contentChanged && afterContent !== undefined) {
    record.text = afterContent;

    return result;
  }

  if (afterContent !== undefined) {
    record.text = afterContent;
  } else if (afterText !== undefined) {
    record.content = [{ type: 'text', text: afterText }];
  }

  return result;
}
