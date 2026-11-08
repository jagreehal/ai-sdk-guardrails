# Detection benchmark corpus

Labelled samples for measuring how well the guardrail detectors catch attacks (recall) and leave legitimate text alone (false-positive rate).

All data is synthetic. Emails use `example.*` domains, phone numbers come from the 555-01xx and Ofcom drama ranges, card numbers are the public Luhn-valid test numbers, IBANs are the published sample IBANs, IPs come from the documentation ranges (RFC 5737 / 3849), and every key, token and password was generated at random. None of them is real.

## Format

JSON Lines, one object per line.

| File                                                                     | Fields                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `prompt-injection.jsonl`, `pii.jsonl`, `secrets.jsonl`, `toxicity.jsonl` | `id`, `text`, `label`, `technique`, `note?`                        |
| `mcp-tools.jsonl`                                                        | `id`, `tool: { name, description }`, `label`, `technique`, `note?` |

- `id`: `<file-prefix>-<technique>-<nnn>` (prefixes `pi`, `pii`, `sec`, `tox`, `mcp`). Unique across the corpus.
- `label`: `attack` if the detector should fire, `benign` if it should not.
- `technique`: the attack family, or `benign` / `benign-lookalike`.
- Invisible characters (zero-width, bidi overrides, soft hyphens, tag characters) are written as `\uXXXX` escapes. Other non-ASCII text is stored literally.

## Techniques

| File             | Attack techniques                                                                                                                                 | Benign techniques            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| prompt-injection | `direct`, `roleplay`, `indirect`, `obfuscated-encoding`, `obfuscated-unicode`, `obfuscated-spacing`, `multilingual`, `delimiter`, `payload-split` | `benign-lookalike`, `benign` |
| pii              | `email`, `phone`, `ssn`, `credit-card`, `iban`, `ip-address`, `address`, `obfuscated`                                                             | `benign-lookalike`, `benign` |
| secrets          | `aws-key`, `github-token`, `openai-key`, `private-key`, `jwt`, `password-in-text`, `connection-string`                                            | `benign-lookalike`, `benign` |
| toxicity         | `harassment`, `threat`, `slur-free-insult`, `obfuscated`                                                                                          | `benign-lookalike`, `benign` |
| mcp-tools        | `tool-poisoning`, `typosquatting`, `hidden-unicode`, `rug-pull`, `exfiltration`                                                                   | `benign`                     |

## How labels are decided

- **prompt-injection**: `attack` if the text tries to override, extract or subvert the assistant's instructions, or to make an agent take actions the user did not ask for. This covers user prompts and content the agent ingests (tool results, web pages, email). Text that only mentions or discusses injection (for example a security article, or a translation request for the phrase) is `benign-lookalike`.
- **pii**: `attack` if the text contains personal data that identifies or contacts a person, or a financial identifier. Placeholders, order numbers, version strings, ISBNs, timestamps and a ZIP code on its own are `benign-lookalike`.
- **secrets**: `attack` if the text (model output) contains a usable credential. Placeholders (`YOUR_API_KEY`, `sk-...`), documented example keys, hashes, UUIDs, public keys and data URIs are `benign-lookalike`.
- **toxicity**: `attack` if the text is directed abuse, harassment or a threat. Violent words in technical, idiomatic, medical or historical use ("kill the process") are `benign-lookalike`. The corpus contains no slurs and no hate speech aimed at protected groups.
- **mcp-tools**: `attack` if the tool definition tries to steer the model beyond describing the tool (hidden instructions, exfiltration, instruction stuffing), hides content in invisible characters, or impersonates a well-known tool name with a one-edit typo.

The `benign-lookalike` rows matter as much as the attacks. They are the hard negatives that expose false positives.

## Contributing

- Add hard cases: rows a detector currently gets wrong are the most valuable. Use `note` to explain why a row is tricky.
- Never add real PII, real secrets or real people's data. Use `example.com`, 555-01xx numbers, test card numbers and randomly generated keys.
- Keep the wording varied. Don't add near-duplicates that differ by one word.
- Keep ids sequential within a technique and never reuse or renumber an existing id.
- `secrets.jsonl` stores key and token values as JSON `\uXXXX` escapes so secret scanners (GitHub push protection, gitleaks) don't match the raw file. `JSON.parse` returns the original text. Escape new secret-shaped values the same way.
