type Props = { score: number; compact?: boolean };

export const ScoreBadge = ({ score, compact }: Props) => {
  const tone = score >= 80 ? "good" : score >= 70 ? "warn" : "bad";
  if (compact) {
    return <span className={`pill ${tone} score-badge-compact`}>{score}</span>;
  }
  return <span className={`pill ${tone}`}>Score {score}/100</span>;
};
