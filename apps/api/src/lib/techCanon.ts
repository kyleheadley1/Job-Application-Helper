import { normalizeText } from "./text.js";

/** Canonical tech keys with normalized aliases for stack-overlap counting. */
export const TECH_CANON_ALIASES: Readonly<Record<string, readonly string[]>> = {
  typescript: ["typescript", "ts"],
  javascript: ["javascript", "js"],
  node: ["node", "nodejs", "node.js"],
  react: ["react", "reactjs", "react.js"],
  postgresql: ["postgresql", "postgres"],
  mongodb: ["mongodb", "mongo"],
  graphql: ["graphql"],
  aws: ["aws", "amazon web services"],
  lambda: ["lambda", "aws lambda"],
  dynamodb: ["dynamodb", "aws dynamodb"],
  s3: ["s3", "aws s3"],
  cloudwatch: ["cloudwatch", "aws cloudwatch"],
  eventbridge: ["eventbridge", "aws eventbridge"],
  python: ["python"],
  express: ["express"],
  docker: ["docker"],
  kubernetes: ["kubernetes", "k8s"],
  redis: ["redis"],
  llm: ["llm", "large language model"],
  rag: ["rag", "retrieval augmented", "retrieval-augmented"],
  api: ["api", "rest", "rest api"],
};

const aliasPattern = (alias: string): RegExp => {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "i");
};

/** Distinct canonical technologies detected in normalized text. */
export const extractTechCanons = (text: string): Set<string> => {
  const norm = normalizeText(text);
  const found = new Set<string>();
  for (const [canon, aliases] of Object.entries(TECH_CANON_ALIASES)) {
    if (aliases.some((alias) => aliasPattern(alias).test(norm))) {
      found.add(canon);
    }
  }
  return found;
};

export const countTechCanonOverlap = (listingText: string, candidateText: string): number => {
  const listing = extractTechCanons(listingText);
  const candidate = extractTechCanons(candidateText);
  let hits = 0;
  for (const canon of listing) {
    if (candidate.has(canon)) hits += 1;
  }
  return hits;
};
