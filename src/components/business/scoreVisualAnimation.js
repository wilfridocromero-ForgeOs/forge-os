export const SCORE_REVEAL_DURATION = 1200;

export function easeScoreReveal(progress) {
  const value = Math.min(1, Math.max(0, Number(progress) || 0));
  return 1 - Math.pow(1 - value, 3);
}

export function getScoreAnimationStart(currentValue, hasRevealed) {
  return hasRevealed && Number.isFinite(Number(currentValue)) ? Number(currentValue) : 0;
}

export function getScoreRevealTransition({
  hasScore,
  reduceMotion,
  currentScore,
  hasRevealed,
  targetScore,
  maxScore,
}) {
  const progressFor = (value) => {
    const maximum = Number(maxScore);
    if (!Number.isFinite(maximum) || maximum <= 0) return 0;
    return Math.min(100, Math.max(0, (Number(value) / maximum) * 100));
  };
  if (!hasScore) return { mode: "reset", fromScore: 0, fromProgress: 0 };
  if (reduceMotion) {
    return {
      mode: "immediate",
      fromScore: targetScore,
      fromProgress: progressFor(targetScore),
    };
  }
  const fromScore = getScoreAnimationStart(currentScore, hasRevealed);
  return {
    mode: fromScore === targetScore ? "settled" : "animate",
    fromScore,
    fromProgress: progressFor(fromScore),
  };
}

export function interpolateScoreValue(from, to, progress) {
  if (progress >= 1) return to;
  const value = Number(from) + (Number(to) - Number(from)) * easeScoreReveal(progress);
  return Number.isInteger(Number(to)) ? Math.round(value) : Math.round(value * 100) / 100;
}

export function prefersReducedScoreMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}
