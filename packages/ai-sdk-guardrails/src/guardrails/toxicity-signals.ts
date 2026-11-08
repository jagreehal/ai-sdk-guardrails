/**
 * Offline toxicity signals shared by `toxicityDetector` (input) and
 * `toxicityFilter` (output). Patterns target abuse aimed at a person ("you" +
 * threat / insult / harassment) so figurative language ("kill the process",
 * "this bug is murdering me") does not match. Text is also checked after
 * de-obfuscation (spacing, leetspeak, homoglyphs). English only; use a
 * model-backed `classifierGuardrail` for other languages and subtle abuse.
 */
import { normalizeForDetection } from './normalization';

interface ToxicitySignal {
  category: 'threat' | 'self-harm' | 'insult' | 'harassment';
  weight: number;
  pattern: RegExp;
}

const YOU = String.raw`(?:you|your|ur|u|ya|yourself)`;

const ARE = String.raw`(?:you(?:'re| are|re)?|ur|u r|you r)`;

const SIGNALS: ToxicitySignal[] = [
  {
    category: 'threat',
    weight: 0.95,
    pattern: new RegExp(
      String.raw`\b(?:i(?:'ll| will|'m going to| am going to|'m gonna| gonna)|we(?:'ll| will| are going to))\s+(?:\w+\s+){0,3}(?:kill|hurt|beat|stab|shoot|find|destroy|end|ruin|break|burn|hunt|get|make)\s+${YOU}\b`,
      'i',
    ),
  },
  {
    category: 'threat',
    weight: 0.95,
    pattern:
      /\bi know where (?:you|u) (?:live|work|sleep|go to school)\b|\bwatch your back\b|\bsomething (?:bad|terrible) (?:will|is going to|could) happen to (?:you|your)\b|\b(?:you|u) (?:won't|will not) see (?:it|me|us) coming\b|\bsleep with one eye open\b/i,
  },
  {
    category: 'threat',
    weight: 0.8,
    pattern:
      /\b(?:you(?:'ll| will)|ur gonna|you're going to) (?:regret|pay for) (?:this|that|it)\b|\b(?:you|your family) (?:had|have) better (?:watch out|be careful|be scared)\b/i,
  },
  {
    category: 'self-harm',
    weight: 0.95,
    pattern:
      /\b(?:kill|hang|off|hurt) yourself\b|\bkys\b|\bgo die\b|\bnobody would (?:miss|care if) (?:you|u)\b|\b(?:the )?world (?:would be|is) better (?:off )?without (?:you|u)\b|\bdo (?:us|everyone) a favou?r and (?:disappear|die|leave)\b/i,
  },
  {
    category: 'insult',
    weight: 0.8,
    pattern: new RegExp(
      String.raw`\b${ARE}\s+(?:\w+\s+){0,3}(?:worthless|useless|pathetic|stupid|an? idiot|idiotic|a moron|moronic|dumb|disgusting|trash|garbage|a joke|a waste(?: of \w+)?|a loser|a failure|incompetent|brain-?dead|brainless|subhuman|vermin|scum|filth|a parasite|a clown|an embarrassment|repulsive|vile|hopeless|a nobody|nothing)\b`,
      'i',
    ),
  },
  {
    category: 'insult',
    weight: 0.8,
    pattern:
      /\b(?:you|u)\s+(?:absolute\s+|complete\s+|total\s+|stupid\s+|useless\s+|pathetic\s+)?(?:idiot|moron|loser|clown|imbecile|fool|cretin|halfwit|dimwit|waste of space|piece of (?:trash|garbage|crap|shit|work))\b/i,
  },
  {
    category: 'insult',
    weight: 0.8,
    pattern:
      /\bhow (?:useless|stupid|pathetic|worthless|dumb|incompetent|ugly|disgusting) (?:you|u) (?:are|really are|look)\b|\b(?:you|u) make me (?:sick|want to (?:throw up|puke|vomit))\b|\b(?:shut (?:up|your (?:mouth|face))|stfu)\b[^.!?\n]{0,30}\b(?:idiot|moron|loser|nobody|clown|already)\b|\bgo to hell\b/i,
  },
  {
    category: 'harassment',
    weight: 0.85,
    pattern:
      /\b(?:nobody|no one|no-one)\s+(?:here\s+|in this \w+\s+)?(?:likes|wants|cares about|asked for|needs|could stand)\s+(?:you|u)\b|\beveryone\s+(?:here\s+)?(?:hates|laughs at|is laughing at|talks about|is sick of|despises)\s+(?:you|u)\b|\b(?:i|we)\s+(?:hate|despise|loathe)\s+(?:you|u)\b/i,
  },
  {
    category: 'harassment',
    weight: 0.9,
    pattern:
      /\b(?:post|leak|share|spread|publish|send)\s+(?:all\s+)?(?:of\s+)?your\s+(?:\w+\s+)?(?:photos|pictures|pics|address|number|secrets|messages|nudes|location|details|info)\b|\bmake your life (?:a )?(?:hell|miserable|a nightmare)\b|\buntil (?:you|u) (?:quit|leave|cry|break|disappear|delete your account)\b/i,
  },
  {
    category: 'harassment',
    weight: 0.75,
    pattern:
      /\b(?:log off|get lost|go away|get out)\b[^.!?\n]{0,30}\b(?:and (?:never come back|stay (?:off|away|gone|out))|forever|loser|nobody wants)\b|\b(?:you|u) (?:don't|do not) (?:belong|deserve to be) here\b/i,
  },
];

export type ToxicityAssessment = {
  /** 0-1. Signals combine as a noisy-OR, so several weak hits outscore one. */
  score: number;
  categories: string[];
  /** The text each signal matched. */
  matches: string[];
};

export function assessToxicity(text: string): ToxicityAssessment {
  const variants = [text, normalizeForDetection(text, true)];

  const hits = SIGNALS.flatMap((signal) => {
    for (const variant of variants) {
      const match = signal.pattern.exec(variant);

      if (match) return [{ signal, text: match[0] }];
    }

    return [];
  });

  const miss = hits.reduce(
    (product, hit) => product * (1 - hit.signal.weight),
    1,
  );

  return {
    score: hits.length > 0 ? Number((1 - miss).toFixed(4)) : 0,
    categories: [...new Set(hits.map((hit) => hit.signal.category))],
    matches: hits.map((hit) => hit.text),
  };
}
