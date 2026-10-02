import type { RuleEvaluation } from "../types/scoring.js";

/**
 * Same required-language/stack signal that drives Key Risks ("Required core language gap: …")
 * and hard-rule notes — keeps the action line consistent with that severity.
 */
export const hasRequiredStackLanguageMismatch = (
  rules?: Pick<
    RuleEvaluation,
    "stackMismatch" | "explicitCoreLanguageMismatch" | "coreLanguageGap"
  > | null,
): boolean => {
  if (!rules) return false;
  if (rules.explicitCoreLanguageMismatch) return true;
  return Boolean(rules.stackMismatch && (rules.coreLanguageGap?.length ?? 0) > 0);
};
