export function getScoreProgress(score, maxScore = 1000) {
  const numericScore = Number(score);
  const numericMax = Number(maxScore);
  if (!Number.isFinite(numericScore) || !Number.isFinite(numericMax) || numericMax <= 0) return 0;
  return Math.min(100, Math.max(0, (numericScore / numericMax) * 100));
}

export function getScorePoint(progress, radius = 92, center = 110) {
  const angle = ((Math.min(100, Math.max(0, Number(progress) || 0)) * 3.6) - 90) * (Math.PI / 180);
  return {
    x: center + radius * Math.cos(angle),
    y: center + radius * Math.sin(angle),
  };
}
