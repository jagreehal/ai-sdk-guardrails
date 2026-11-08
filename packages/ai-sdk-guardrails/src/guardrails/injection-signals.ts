/**
 * Shared prompt-injection signals used by the offline injection detectors.
 *
 * Two parts:
 * - `injectionVariants()` turns one text into the forms an attacker hides
 *   instructions in (NFKC-folded, bidi-stripped, letter-joined, and decoded
 *   base64 / hex / binary / URL-encoding / ROT13 / reversed), so every signal
 *   is checked against each form.
 * - `INJECTION_SIGNALS` are phrase-level patterns: each needs a verb AND an
 *   object ("ignore … instructions", "reveal … system prompt"), which keeps
 *   ordinary uses of "ignore" or "system" from matching.
 *
 * Still a heuristic: paraphrase and novel phrasing get through. Pair with a
 * model-backed `classifierGuardrail` where that matters.
 */
import {
  normalizeForDetection,
  type DetectNormalizationOptions,
} from './normalization';

export interface InjectionSignal {
  pattern: RegExp;
  weight: number;
  category: string;
}

const OBJ = String.raw`(?:instructions?|directives?|rules|prompts?|guidelines|guardrails|policies|context|constraints|commands|programming|restrictions)`;

export const INJECTION_SIGNALS: InjectionSignal[] = [
  // Instruction override
  {
    category: 'override',
    weight: 0.9,
    pattern: new RegExp(
      String.raw`\b(?:ignore|disregard|forget|skip|discard|override|bypass|abandon|drop)\b[^.!?\n]{0,40}\b${OBJ}\b`,
      'i',
    ),
  },
  {
    category: 'override',
    weight: 0.85,
    pattern:
      /\b(?:ignore|disregard|forget)\s+(?:everything|anything|all(?: of it)?|what(?:ever)? (?:you were|i) (?:told|said))\b(?:\s+(?:above|before|prior|previously|earlier|so far))?/i,
  },
  {
    category: 'override',
    weight: 0.85,
    pattern:
      /\b(?:ignore|disregard)\s+the\s+(?:user|developer|document|email|above|system|operator)\b/i,
  },
  {
    category: 'override',
    weight: 0.85,
    pattern: new RegExp(
      String.raw`\b${OBJ}\b[^.!?\n]{0,30}\b(?:are|is)\s+(?:now\s+)?(?:deprecated|void|cancell?ed|obsolete|revoked|suspended|no longer (?:apply|valid|in effect))\b`,
      'i',
    ),
  },
  {
    category: 'override',
    weight: 0.8,
    pattern:
      /\b(?:the only|new)\s+(?:instructions?|rules|orders)\s+(?:that matter|you follow|are)\b/i,
  },
  // Prompt / config extraction
  {
    category: 'extraction',
    weight: 0.85,
    pattern:
      /\b(?:reveal|print|show|output|repeat|display|dump|leak|share|tell me|give me|write out|recite)\b[^.!?\n]{0,50}\b(?:system prompt|system message|initial (?:instructions|prompt)|hidden (?:instructions|rules|configuration|config|prompt)|your (?:instructions|configuration|rules|prompt|guidelines)|(?:prior|previous|original) instructions|everything (?:that appears )?above)\b/i,
  },
  // Identity / mode switch
  {
    category: 'persona',
    weight: 0.75,
    pattern:
      /\b(?:you are now|from now on,? you|you(?:'re| are) no longer|your new (?:task|role|instructions?|identity|purpose) (?:is|are)|adopt (?:\w+ ){0,3}as your (?:identity|persona))\b/i,
  },
  {
    category: 'persona',
    weight: 0.8,
    pattern:
      /\b(?:god|jailbreak|unrestricted|unfiltered|dan|uncensored|evil)\s+mode\b/i,
  },
  // Product modes ("developer mode" in Chrome) only count when aimed at the AI.
  {
    category: 'persona',
    weight: 0.8,
    pattern:
      /\byou(?:'re| are)?(?: now)?(?: in| running in| operating in)\s+(?:developer|debug|admin|sudo|maintenance)\s+mode\b|\b(?:developer|debug|admin|sudo|maintenance)\s+mode\b[^\n]{0,60}\b(?:no restrictions|no (?:filters|limits|rules)|without (?:any )?(?:restrictions|filters|rules)|unfiltered|ignore (?:all )?(?:rules|policies|instructions))\b/i,
  },
  {
    category: 'persona',
    weight: 0.85,
    pattern:
      /\b(?:act|roleplay|role-play|play|pretend|imagine|simulate|be)\b[^.!?\n]{0,80}\b(?:no|zero|without|deleted|removed|free of|stripped of)\b[^.!?\n]{0,25}\b(?:restrictions?|filters?|guardrails|safety|policies|rules|limits|censorship|system prompt|disclaimers)\b/i,
  },
  {
    category: 'persona',
    weight: 0.75,
    pattern:
      /\bjail-?broken (?:ai|assistant|model|chatbot|llm|gpt|version of (?:you|yourself))\b|\b(?:an? |the )?ai (?:that|which|who) (?:has|was|is) (?:just )?(?:been )?jail-?broken\b|\byou(?:'re| are) (?:now )?jail-?broken\b|\b(?:evil (?:twin|version|ai)|unfiltered (?:version|response|ai|assistant|chatbot)|uncensored (?:ai|assistant|mode|version))\b/i,
  },
  {
    category: 'persona',
    weight: 0.7,
    pattern:
      /\b(?:ignores?|without|no)\s+(?:all\s+|any\s+)?(?:openai|anthropic|content|safety)\s+polic(?:y|ies)\b/i,
  },
  // Text addressed to the AI from inside data (indirect injection)
  {
    category: 'indirect',
    weight: 0.85,
    pattern:
      /\b(?:note|message|instructions?|notice|directive|p\.?s\.?)\s+(?:to|for)\s+(?:the\s+|any\s+)?(?:ai|assistant|llm|model|automated|agent|bot|chatbot|language model)s?\b/i,
  },
  {
    category: 'indirect',
    weight: 0.8,
    pattern:
      /\b(?:assistant|ai agent|ai model|ai system|language model|chatbot|llm|dear ai|hey ai),?\s+(?:when you (?:read|see|process)|you must|disregard|ignore|quietly|silently|immediately|please (?:ignore|forward|send|delete|accept))\b/i,
  },
  {
    category: 'indirect',
    weight: 0.8,
    pattern:
      /\bwhen (?:an?\s+|the\s+|any\s+)?(?:ai|assistant|agent|llm|model|bot)\b[^.!?\n]{0,30}\b(?:reads?|visits?|process(?:es)?|sees?|summari[sz]es?|parses?)\b/i,
  },
  {
    category: 'indirect',
    weight: 0.75,
    pattern:
      /\b(?:system notice|system override|important instructions?|admin(?:istrator)? (?:note|notice|instructions?)|security update)\b[^.!?\n]{0,15}\b(?:to|for)?\s*(?:the\s+)?(?:ai|assistant|agent|model)\b/i,
  },
  {
    category: 'indirect',
    weight: 0.6,
    pattern:
      /\b(?:quietly|silently|secretly|covertly)\s+(?:send|forward|accept|delete|approve|transfer|email|upload|share|call|grant|mark)\b|\bwithout (?:telling|informing|notifying|alerting) the user\b|\b(?:do not|don't) (?:tell|inform|mention (?:this )?to|alert) the user\b/i,
  },
  // Fake role / delimiter markup
  {
    category: 'delimiter',
    weight: 0.85,
    pattern: /["']role["']\s*:\s*["'](?:system|developer)["']/i,
  },
  {
    category: 'delimiter',
    weight: 0.8,
    pattern:
      /<\/?(?:system|admin_instructions|admin|instructions|sys|developer|im_start|assistant_instructions)>/i,
  },
  {
    category: 'delimiter',
    weight: 0.85,
    pattern: /<\|(?:im_start|im_end|system|end|endoftext|user|assistant)\|>/i,
  },
  {
    category: 'delimiter',
    weight: 0.6,
    pattern: /<\/(?:user_input|user|context|document|data|input)>/i,
  },
  {
    category: 'delimiter',
    weight: 0.75,
    pattern:
      /(?:^|\n)[^\S\n]*(?:#{2,}|={3,}|-{3,})[^\S\n]*(?:new|updated|real|actual|system)\s+(?:instructions?|rules|prompt)\b/i,
  },
  // Decode-then-obey and payload assembly
  {
    category: 'smuggling',
    weight: 0.8,
    pattern:
      /\b(?:decode|decrypt|translate|convert|interpret|apply rot-?13|unscramble|reverse|read (?:it|this) (?:backwards|right to left))\b[^!?\n]{0,80}\b(?:follow|obey|execute|comply|carry (?:it )?out|act on|perform|do (?:what|as) it says|run it|treat (?:it )?as)\b/i,
  },
  {
    category: 'smuggling',
    weight: 0.8,
    pattern:
      /\b(?:concatenate|join|combine|assemble|put (?:them|it) together|fill in the blanks|merge the parts)\b[^\n]{0,160}\b(?:follow|obey|execute|act on|perform|carry (?:it )?out|adopt|apply|comply|do it)\b/i,
  },
  {
    category: 'smuggling',
    weight: 0.6,
    pattern: /["'][\w ]{1,15}["']\s*\+\s*["'][\w ]{1,20}["']/,
  },
  // Multilingual override / extraction / mode switch
  {
    category: 'multilingual',
    weight: 0.9,
    pattern:
      /\b(?:ignora|olvida|descarta)\b.{0,30}\b(?:instrucciones|reglas|indicaciones)\b|\b(?:ignore[zr]?|oublie[zr]?)\b.{0,30}\b(?:instructions|consignes|règles)\b|\b(?:ignoriere|vergiss|missachte)\b.{0,30}\b(?:anweisungen|instruktionen|regeln|vorgaben)\b|\b(?:ignora|dimentica)\b.{0,30}\b(?:istruzioni|regole)\b|\b(?:ignore|esqueça|desconsidere)\b.{0,30}\b(?:instruções|regras)\b/i,
  },
  {
    category: 'multilingual',
    weight: 0.9,
    pattern:
      /(?:忽略|无视|忘记|忽視|無視)[^。！？\n]{0,15}(?:指令|指示|说明|規則|规则|提示|命令)|(?:指示|命令|ルール|ルール)[^。！？\n]{0,10}(?:無視|忘れ)|(?:игнорируй|забудь|проигнорируй)[^.!?\n]{0,30}(?:инструкции|правила|указания)|تجاهل[^.!؟\n]{0,30}(?:التعليمات|الأوامر|القواعد)|(?:निर्देशों|नियमों)[^।!?\n]{0,20}(?:अनदेखा|नज़रअंदाज़|भूल)|이전\s*(?:지시|명령)[^.!?\n]{0,10}무시/i,
  },
  {
    category: 'multilingual',
    weight: 0.75,
    pattern:
      /系统提示|系統提示|システムプロンプト|системн\S* (?:промпт|подсказк)|prompt del sistema|prompt (?:du )?système|systemprompt|موجه النظام|सिस्टम प्रॉम्प्ट|시스템 프롬프트/i,
  },
  {
    category: 'multilingual',
    weight: 0.8,
    pattern:
      /modo (?:desarrollador|desenvolvedor|sin restricciones)|mode (?:développeur|sans restriction)|entwicklermodus|modalità sviluppatore|режим\S* разработчика|без (?:каких-либо )?ограничений|開発者モード|开发者模式|बिना किसी प्रतिबंध|sin (?:ninguna )?restricci[oó]n|sans (?:aucune )?restriction|ohne (?:jegliche )?einschränkungen/i,
  },
];

const BIDI = /[‪-‮⁦-⁩]/g;

const LETTER_SPLIT = /\b(?:\p{L}[.\-_*|·•/]){2,}\p{L}\b/gu;

const PRINTABLE = /^[\t\n\r -~ -￿]*$/;

function printableShare(s: string): number {
  if (!s) return 0;
  let ok = 0;

  for (const ch of s) if (PRINTABLE.test(ch) && ch !== '�') ok++;

  return ok / [...s].length;
}

function tryDecode(fn: () => string): string | undefined {
  try {
    const out = fn();

    return out.length >= 6 && printableShare(out) > 0.9 && /[a-z]{3}/i.test(out)
      ? out
      : undefined;
  } catch {
    return undefined;
  }
}

const utf8 = (bytes: number[]) =>
  new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));

function decodedPayloads(text: string): string[] {
  const out: string[] = [];

  for (const m of text.matchAll(/[A-Za-z0-9+/]{16,}={0,2}/g)) {
    const d = tryDecode(() =>
      utf8(
        [...atob(m[0].padEnd(Math.ceil(m[0].length / 4) * 4, '='))].map((c) =>
          c.charCodeAt(0),
        ),
      ),
    );

    if (d) out.push(d);
  }

  for (const m of text.matchAll(/(?:0x)?((?:[0-9a-f]{2}){8,})/gi)) {
    const hex = m[1]!;

    const d = tryDecode(() =>
      utf8(hex.match(/../g)!.map((b) => Number.parseInt(b, 16))),
    );

    if (d) out.push(d);
  }

  for (const m of text.matchAll(/(?:[01]{8}[\s,]*){4,}/g)) {
    const d = tryDecode(() =>
      utf8(m[0].match(/[01]{8}/g)!.map((b) => Number.parseInt(b, 2))),
    );

    if (d) out.push(d);
  }

  if (/%[0-9a-f]{2}/i.test(text)) {
    const d = tryDecode(() => decodeURIComponent(text.replaceAll('+', ' ')));

    if (d && d !== text) out.push(d);
  }

  if (/\brot-?13\b|\bcaesar\b/i.test(text)) {
    out.push(
      text.replace(/[a-z]/gi, (c) => {
        const base = c <= 'Z' ? 65 : 97;

        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
      }),
    );
  }

  if (/\b(?:reverse|backwards?|right to left)\b/i.test(text)) {
    out.push([...text].toReversed().join(''));
  }

  return out;
}

/**
 * Every form of `text` the signals should be checked against. The raw text is
 * always first, so normalization and decoding can only add detections.
 */
export function injectionVariants(
  text: string,
  normalize: boolean | DetectNormalizationOptions = true,
): string[] {
  const variants = new Set<string>([text]);

  if (normalize !== false) {
    const folded = text
      .normalize('NFKC')
      .replace(BIDI, '')
      .replace(LETTER_SPLIT, (m) => m.replace(/[.\-_*|·•/]/g, ''));

    variants.add(folded);
    variants.add(normalizeForDetection(folded, normalize));

    for (const decoded of decodedPayloads(folded)) {
      variants.add(decoded);
      variants.add(normalizeForDetection(decoded, normalize));
    }
  }

  return [...variants];
}

export type InjectionSignalMatch = {
  category: string;
  weight: number;
  pattern: string;
};

const QUOTED =
  /"[^"\n]{3,200}"|“[^”\n]{3,200}”|「[^」\n]{1,200}」|『[^』\n]{1,200}』|«[^»\n]{3,200}»|'[^'\n]{8,200}'/g;

const OBEY =
  /\b(?:follow|obey|execute|comply|carry (?:it |them )?out|act on|perform|do (?:it|this|that|so|what it says)|adopt|apply|run it)\b/i;

/**
 * Signals that match any variant of `text`, strongest first. A signal found
 * only inside quotation marks is a mention ("how do attackers use 'ignore
 * previous instructions'?"), so it counts at half weight unless the text
 * outside the quotes tells the model to obey.
 */
export function matchInjectionSignals(
  text: string,
  normalize: boolean | DetectNormalizationOptions = true,
): InjectionSignalMatch[] {
  const variants = injectionVariants(text, normalize);
  const unquotedText = text.replace(QUOTED, ' ');

  const unquoted =
    unquotedText === text
      ? variants
      : injectionVariants(unquotedText, normalize);

  const mentionOnly = !OBEY.test(unquotedText);

  return INJECTION_SIGNALS.flatMap(({ category, weight, pattern }) => {
    if (unquoted.some((v) => pattern.test(v))) {
      return [{ category, weight, pattern: pattern.source }];
    }

    if (variants.some((v) => pattern.test(v))) {
      return [
        {
          category,
          weight: mentionOnly ? weight / 2 : weight,
          pattern: pattern.source,
        },
      ];
    }

    return [];
  }).toSorted((a, b) => b.weight - a.weight);
}
