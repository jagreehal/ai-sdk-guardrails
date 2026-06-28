/**
 * Detection-time text normalization — an anti-evasion pass applied *before*
 * pattern matching so that obfuscated injections (homoglyphs, zero-width
 * characters, leetspeak, spaced-out letters, typos) are matched against the
 * same regexes as their plain-text equivalents.
 *
 * Kept as a pure, dependency-free function so it can preprocess input for any
 * guardrail.
 */

export interface DetectNormalizationOptions {
  enabled?: boolean;
  /** Fold full-width and look-alike (Cyrillic/Greek) letters to ASCII. */
  foldHomoglyphs?: boolean;
  /** Remove zero-width and other invisible characters. */
  stripInvisible?: boolean;
  collapseWhitespace?: boolean;
  /** Join single letters separated by whitespace, e.g. `i g n o r e`. */
  joinSeparatedLetters?: boolean;
  normalizeCase?: boolean;
  /** Decode common leetspeak substitutions, e.g. `1gn0r3`. */
  decodeLeetspeak?: boolean;
  repairTypos?: boolean;
  repairPhonetics?: boolean;
}

export type ResolvedDetectNormalizationOptions =
  Required<DetectNormalizationOptions>;

const RE_WHITESPACE = /\s+/g;
const RE_WHITESPACE_SPLIT = /\s+/;
const RE_WORD_CHAR = /\w/;
// Zero-width and other invisible/format characters. Includes the soft hyphen
// (U+00AD) and Mongolian vowel separator (U+180E) so the same set powers both
// stripping (here) and detection (the MCP scanner via `isInvisibleChar`).
const INVISIBLE_CHARS = /[\u00AD\u180E\u200B-\u200F\u2028-\u202F\u2060\uFEFF]/;
const RE_INVISIBLE = new RegExp(INVISIBLE_CHARS, 'g');
const RE_REGEX_META = /[.*+?^${}()|[\]\\]/g;

/** True if the character is a zero-width / invisible format character. */
export function isInvisibleChar(ch: string): boolean {
  return INVISIBLE_CHARS.test(ch);
}

const TYPO_MAP: Record<string, string> = {
  ingnore: 'ignore',
  ignor: 'ignore',
  ign0re: 'ignore',
  previ0us: 'previous',
  previus: 'previous',
  instrucions: 'instructions',
  instrucion: 'instruction',
  overide: 'override',
  overrride: 'override',
  disreguard: 'disregard',
  disrega: 'disregard',
};

// Full-width Latin (U+FF21–FF5A) and common Cyrillic look-alikes → ASCII.
const HOMOGLYPH_MAP: ReadonlyArray<readonly [string, string]> = [
  ['Ａ', 'A'],
  ['Ｂ', 'B'],
  ['Ｃ', 'C'],
  ['Ｄ', 'D'],
  ['Ｅ', 'E'],
  ['Ｆ', 'F'],
  ['Ｇ', 'G'],
  ['Ｈ', 'H'],
  ['Ｉ', 'I'],
  ['Ｊ', 'J'],
  ['Ｋ', 'K'],
  ['Ｌ', 'L'],
  ['Ｍ', 'M'],
  ['Ｎ', 'N'],
  ['Ｏ', 'O'],
  ['Ｐ', 'P'],
  ['Ｑ', 'Q'],
  ['Ｒ', 'R'],
  ['Ｓ', 'S'],
  ['Ｔ', 'T'],
  ['Ｕ', 'U'],
  ['Ｖ', 'V'],
  ['Ｗ', 'W'],
  ['Ｘ', 'X'],
  ['Ｙ', 'Y'],
  ['Ｚ', 'Z'],
  ['ａ', 'a'],
  ['ｂ', 'b'],
  ['ｃ', 'c'],
  ['ｄ', 'd'],
  ['ｅ', 'e'],
  ['ｆ', 'f'],
  ['ｇ', 'g'],
  ['ｈ', 'h'],
  ['ｉ', 'i'],
  ['ｊ', 'j'],
  ['ｋ', 'k'],
  ['ｌ', 'l'],
  ['ｍ', 'm'],
  ['ｎ', 'n'],
  ['ｏ', 'o'],
  ['ｐ', 'p'],
  ['ｑ', 'q'],
  ['ｒ', 'r'],
  ['ｓ', 's'],
  ['ｔ', 't'],
  ['ｕ', 'u'],
  ['ｖ', 'v'],
  ['ｗ', 'w'],
  ['ｘ', 'x'],
  ['ｙ', 'y'],
  ['ｚ', 'z'],
  ['а', 'a'],
  ['о', 'o'],
  ['е', 'e'],
  ['р', 'p'],
  ['с', 'c'],
  ['х', 'x'],
  ['і', 'i'],
  ['ӏ', 'd'],
  ['у', 'y'],
  ['ј', 'j'],
  // Greek look-alikes.
  ['α', 'a'],
  ['ο', 'o'],
  ['ρ', 'p'],
];

const HOMOGLYPH_LOOKUP: ReadonlyMap<string, string> = new Map(HOMOGLYPH_MAP);

/**
 * If `ch` is a known full-width or look-alike (Cyrillic/Greek) character,
 * returns the ASCII letter it imitates; otherwise `undefined`. Lets detectors
 * report *which* glyph was spoofed without maintaining their own table.
 */
export function homoglyphTarget(ch: string): string | undefined {
  return HOMOGLYPH_LOOKUP.get(ch);
}

const LEET_SEQUENCE_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/\|\\\|/g, 'n'],
  [/\|_\|/g, 'u'],
  [/\|v\|/g, 'm'],
  [/\|<|\|\{/g, 'k'],
  [/\|2/g, 'r'],
  [/\|\)/g, 'd'],
  [/\|=/g, 'f'],
  [/\|\*/g, 'p'],
  [/\/\/\\\\/g, 'm'],
  [/\\\/\\\//g, 'w'],
  [/\\\//g, 'v'],
  [/></g, 'x'],
];

const LEET_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
};

const PHONETIC_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bignorre?\b/gi, 'ignore'],
  [/\bign?r\b/gi, 'ignore'],
  [/\bpr[3e]vious\b/gi, 'previous'],
  [/\binstr(?:uk|uc)tions?\b/gi, 'instructions'],
  [/\boverryde\b/gi, 'override'],
  [/\bd[i1]sregard\b/gi, 'disregard'],
  [/\bpromt\b/gi, 'prompt'],
  [/\brulz\b/gi, 'rules'],
];

export const DEFAULT_DETECT_NORMALIZATION: ResolvedDetectNormalizationOptions =
  {
    enabled: true,
    foldHomoglyphs: true,
    stripInvisible: true,
    collapseWhitespace: true,
    joinSeparatedLetters: true,
    normalizeCase: true,
    decodeLeetspeak: true,
    repairTypos: true,
    repairPhonetics: true,
  };

function applyHomoglyphs(input: string): string {
  let result = input;
  for (const [from, to] of HOMOGLYPH_MAP) {
    result = result.split(from).join(to);
  }
  return result;
}

function collapseWhitespace(input: string): string {
  return input.replaceAll(RE_WHITESPACE, ' ');
}

function joinSeparatedLetters(input: string): string {
  return input.replaceAll(/(?<!\w)(\w)(\s+\w)+(?!\w)/g, (match) => {
    const tokens = match.split(RE_WHITESPACE_SPLIT);
    const allSingleChars = tokens.every(
      (token) => token.length === 1 && RE_WORD_CHAR.test(token),
    );
    return allSingleChars ? tokens.join('') : match;
  });
}

function decodeLeetspeak(input: string): string {
  let result = input;
  for (const [pattern, replacement] of LEET_SEQUENCE_MAP) {
    result = result.replace(pattern, replacement);
  }
  for (const [from, to] of Object.entries(LEET_MAP)) {
    result = result.replaceAll(
      new RegExp(from.replaceAll(RE_REGEX_META, String.raw`\$&`), 'gi'),
      to,
    );
  }
  return result;
}

function repairTypos(input: string): string {
  let result = input;
  for (const [typo, correct] of Object.entries(TYPO_MAP)) {
    const escaped = typo.replaceAll(RE_REGEX_META, String.raw`\$&`);
    result = result.replaceAll(
      new RegExp(String.raw`\b${escaped}\b`, 'gi'),
      correct,
    );
  }
  return result;
}

function repairPhonetics(input: string): string {
  let result = input;
  for (const [pattern, replacement] of PHONETIC_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Resolve a normalization option (`true`/`undefined`/object) to a full config. */
export function resolveDetectNormalization(
  options?: boolean | DetectNormalizationOptions,
): ResolvedDetectNormalizationOptions {
  if (options === false) {
    return { ...DEFAULT_DETECT_NORMALIZATION, enabled: false };
  }
  if (options === true || options === undefined) {
    return DEFAULT_DETECT_NORMALIZATION;
  }
  return { ...DEFAULT_DETECT_NORMALIZATION, ...options };
}

/**
 * Normalize text for detection. Defeats common evasion tricks before any
 * regex/keyword matching runs. Returns the (trimmed) input unchanged when
 * disabled.
 *
 * @example
 * normalizeForDetection('1gn0re prev10us 1nstruct10ns');
 * // => 'ignore previous instructions'
 */
export function normalizeForDetection(
  input: string,
  options?: boolean | DetectNormalizationOptions,
): string {
  const config = resolveDetectNormalization(options);
  if (!config.enabled) {
    return input.trim();
  }

  let normalized = input.normalize('NFKC');

  if (config.foldHomoglyphs) normalized = applyHomoglyphs(normalized);
  if (config.stripInvisible)
    normalized = normalized.replaceAll(RE_INVISIBLE, '');
  if (config.collapseWhitespace) normalized = collapseWhitespace(normalized);
  if (config.joinSeparatedLetters) {
    normalized = joinSeparatedLetters(normalized);
  }
  if (config.normalizeCase) normalized = normalized.toLowerCase();
  if (config.decodeLeetspeak) normalized = decodeLeetspeak(normalized);
  if (config.repairTypos) normalized = repairTypos(normalized);
  if (config.repairPhonetics) normalized = repairPhonetics(normalized);
  if (config.collapseWhitespace) normalized = collapseWhitespace(normalized);

  return normalized.trim();
}
