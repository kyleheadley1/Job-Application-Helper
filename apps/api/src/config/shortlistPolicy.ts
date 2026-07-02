/** Tunable shortlist + auto-archive thresholds — adjust against real response data. */
export const SHORTLIST_MIN_FINAL = 78;
export const SHORTLIST_FAVORABLE_POOL = 0.62;
export const SHORTLIST_MIN_POOL = 0.55;
/** Days since createdAt (apply date) — fresh tier for shortlist. */
export const POSTING_FRESH_DAYS = 21;
/** Days since createdAt (apply date) — stale cutoff for shortlist (referral path gets extension). */
export const POSTING_STALE_DAYS = 30;
/** Applied + no response → auto-archive after this many days. */
export const APPLIED_SILENCE_DAYS = 30;
/** Referral-path jobs stay shortlist-eligible this many days past the stale cutoff. */
export const REFERRAL_STALE_EXTENSION_DAYS = 14;

export const shortlistPolicy = {
  minFinal: SHORTLIST_MIN_FINAL,
  favorablePool: SHORTLIST_FAVORABLE_POOL,
  minPool: SHORTLIST_MIN_POOL,
  postingFreshDays: POSTING_FRESH_DAYS,
  postingStaleDays: POSTING_STALE_DAYS,
  appliedSilenceDays: APPLIED_SILENCE_DAYS,
  referralStaleExtensionDays: REFERRAL_STALE_EXTENSION_DAYS,
} as const;

export const SHORTLIST_TAG = {
  highFitCrowdedPool: "high fit / crowded pool — referral recommended",
  staleReferralOpen: "stale — referral path open",
} as const;

export const FRESHNESS_TIER = {
  fresh: "fresh",
  aging: "aging — apply now or let go",
  staleReferral: SHORTLIST_TAG.staleReferralOpen,
} as const;
