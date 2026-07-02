const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const daysBetween = (fromIso: string, toDate: Date = new Date()): number => {
  const from = new Date(fromIso).getTime();
  if (!Number.isFinite(from)) return Number.POSITIVE_INFINITY;
  return Math.floor((toDate.getTime() - from) / MS_PER_DAY);
};
