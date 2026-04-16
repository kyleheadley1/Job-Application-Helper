type Props = { score: number };

export const ScoreBadge = ({ score }: Props) => {
  const tone = score >= 80 ? "good" : score >= 70 ? "warn" : "bad";
  return <span className={`pill ${tone}`}>Score {score}/100</span>;
};
