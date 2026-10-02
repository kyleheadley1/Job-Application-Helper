/**
 * Go/Golang language detection. "Golang" always counts. A bare "Go" must be standalone
 * (not "go-to") and sit in a language/stack context — listed beside another language or
 * framework, under a languages/stack label, alone on a line, or framed as
 * "in/with/proficient in Go" / "Go services". English uses ("go beyond", "Go above and
 * beyond", "on the go") never count. Case-insensitive because many callers match
 * against lowercased text.
 */

const caseInsensitive = (token: string): string =>
  token.replace(/[a-zA-Z]/g, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);

const STACK_TOKENS = [
  "Python", "Java", "JavaScript", "TypeScript", "Rust", "Ruby", "Scala", "Kotlin", "Swift",
  "C\\+\\+", "C#", "PHP", "Elixir", "Erlang", "Haskell", "OCaml", "Clojure", "Perl", "Dart",
  "Node(?:\\.js)?", "NodeJS", "React", "Rails", "Django", "Flask", "FastAPI", "Spring",
  "gRPC", "GraphQL", "Protobuf", "Kubernetes", "K8s", "Docker", "Terraform",
  "Postgres(?:QL)?", "MySQL", "SQL", "Redis", "Kafka", "AWS", "GCP", "Azure", "Bash",
  "JS", "TS", "C",
];
const STACK = `(?:${STACK_TOKENS.map((t) => (t === "C" ? t : caseInsensitive(t))).join("|")})`;
const GO = "[Gg][Oo](?![\\w'’-])";
const SEP = "\\s*(?:[,/&|+]|\\(|\\)|\\band\\b|\\bor\\b)\\s*(?:(?:and|or)\\s+)?";

const GO_CONTEXT_SOURCES = [
  `\\b${caseInsensitive("golang")}\\b`,
  `(?<![\\w#+])${STACK}${SEP}\\b${GO}`,
  `\\b${GO}${SEP}${STACK}(?![\\w#+])`,
  `\\b${caseInsensitive("language")}s?\\b[^.\\n]{0,50}\\b${GO}`,
  `\\b(?:${caseInsensitive("stack")}|${caseInsensitive("tech")}(?:${caseInsensitive("nologies")}|${caseInsensitive("nology")})?|${caseInsensitive("tools")})\\s*:\\s*(?:[^.\\n]{0,80}?[,/]\\s*)?${GO}`,
  `(?:^|\\n)[ \\t]*(?:[-•*·][ \\t]*)?${GO}[ \\t]*(?=\\n|$)`,
  `\\b(?:in|with|using|written in|proficien(?:t|cy) in|fluen(?:t|cy) in|experience in|expertise in|knowledge of)\\s+${GO}(?!\\s+(?:to|beyond|ahead|back|through|into|from|for|live|deep|above|far|wrong|right)\\b)`,
  `\\b${GO}\\s+(?:language|lang|programming|developers?|engineers?|engineering|services?|backend|microservices?|codebases?|code|stack|modules?|binaries|routines|concurrency|experience|proficiency|required|preferred)\\b`,
  `\\b${GO}\\s+(?:is|as)\\s+(?:our|the|a)\\b[^.\\n]{0,30}\\b(?:language|backend|stack)\\b`,
  `\\b(?:strong|solid|deep|production|professional|idiomatic|modern)\\s+${GO}\\b(?!\\s+(?:to|beyond|ahead|back|through|into|from|for|live|deep|above|far|wrong|right)\\b)`,
];

/** Patterns array for token scanners that expect RegExp[]. */
export const GO_LANGUAGE_PATTERNS: RegExp[] = GO_CONTEXT_SOURCES.map((s) => new RegExp(s));

/** Single combined regex (first match position used for context windows). */
export const GO_LANGUAGE_RE = new RegExp(GO_CONTEXT_SOURCES.join("|"));

export function textMentionsGoLanguage(text: string): boolean {
  return GO_LANGUAGE_RE.test(text);
}

/** Go mentioned on the same line/sentence as preferred / nice-to-have framing. */
export function goMentionedAsPreferred(text: string): boolean {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .some((segment) => /\b(preferred|nice to have|plus)\b/i.test(segment) && textMentionsGoLanguage(segment));
}
