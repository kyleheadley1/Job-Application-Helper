/**
 * Go/Golang language detection that rejects English verb/adjective uses:
 * "go-to", "go find", "go from", "go ahead", etc.
 */
export const GO_LANGUAGE_RE =
  /\bgolang\b|\bgo\b(?!\s*-|-|\s+(?:to|from|find|ahead|back|through|into|with|get|on|for|around|beyond|deep|home|live|wrong|right|figure)\b)/i;

/** Patterns array for token scanners that expect RegExp[]. */
export const GO_LANGUAGE_PATTERNS: RegExp[] = [GO_LANGUAGE_RE];

export function textMentionsGoLanguage(text: string): boolean {
  return GO_LANGUAGE_RE.test(text);
}
