import { useEffect, useId, useRef, useState } from "react";
import {
  getScoreRevealTransition,
  interpolateScoreValue,
  prefersReducedScoreMotion,
  SCORE_REVEAL_DURATION,
} from "./scoreVisualAnimation";
import { getScorePoint, getScoreProgress } from "./scoreVisualGeometry";
import "./IntelligentScoreVisual.css";

const clampCount = (value) => Math.max(0, Math.floor(Number(value) || 0));

export default function IntelligentScoreVisual({
  score = null,
  maxScore = 1000,
  status = "Sin evaluar",
  evaluatedAreas = 0,
  totalAreas = 0,
  size = "dashboard",
  className = "",
  emptyLabel = "Datos insuficientes",
}) {
  const visualId = useId().replaceAll(":", "");
  const hasScore = score !== null && score !== undefined && Number.isFinite(Number(score));
  const targetScore = hasScore ? Number(score) : 0;
  const targetProgress = hasScore ? getScoreProgress(targetScore, maxScore) : 0;
  const reduceMotion = prefersReducedScoreMotion();
  const [displayScore, setDisplayScore] = useState(() => reduceMotion ? targetScore : 0);
  const [displayProgress, setDisplayProgress] = useState(() => reduceMotion ? targetProgress : 0);
  const displayScoreRef = useRef(displayScore);
  const hasRevealedRef = useRef(reduceMotion);
  const renderedScore = !hasScore ? 0 : reduceMotion ? targetScore : displayScore;
  const renderedProgress = !hasScore ? 0 : reduceMotion ? targetProgress : displayProgress;
  const endpoint = getScorePoint(renderedProgress);
  const total = Math.min(12, clampCount(totalAreas));
  const evaluated = Math.min(total, clampCount(evaluatedAreas));
  const scoreText = hasScore ? targetScore.toLocaleString("es-ES", { maximumFractionDigits: 2 }) : "—";
  const displayScoreText = hasScore ? renderedScore.toLocaleString("es-ES", { maximumFractionDigits: 2 }) : "—";
  const accessibleLabel = hasScore
    ? `ORVESEN Score ${scoreText} de ${maxScore}. Estado: ${status}. ${evaluatedAreas} de ${totalAreas} áreas evaluadas.`
    : `ORVESEN Score no disponible. ${emptyLabel}. Estado: ${status}. ${evaluatedAreas} de ${totalAreas} áreas evaluadas.`;

  useEffect(() => {
    if (!hasScore) {
      displayScoreRef.current = 0;
      hasRevealedRef.current = false;
      return undefined;
    }

    if (reduceMotion) {
      displayScoreRef.current = targetScore;
      hasRevealedRef.current = true;
      return undefined;
    }

    const transition = getScoreRevealTransition({
      hasScore,
      reduceMotion,
      currentScore: displayScoreRef.current,
      hasRevealed: hasRevealedRef.current,
      targetScore,
      maxScore,
    });
    const { fromScore, fromProgress } = transition;
    hasRevealedRef.current = true;
    if (transition.mode !== "animate" || fromProgress === targetProgress) return undefined;
    let frameId = 0;
    let startedAt = 0;

    const animate = (timestamp) => {
      if (!startedAt) startedAt = timestamp;
      const elapsed = timestamp - startedAt;
      const animationProgress = Math.min(1, elapsed / SCORE_REVEAL_DURATION);
      const nextScore = interpolateScoreValue(fromScore, targetScore, animationProgress);
      const nextProgress = fromProgress + (targetProgress - fromProgress) * (1 - Math.pow(1 - animationProgress, 3));
      displayScoreRef.current = nextScore;
      setDisplayScore(nextScore);
      setDisplayProgress(animationProgress >= 1 ? targetProgress : nextProgress);
      if (animationProgress < 1) frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(animate);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [hasScore, maxScore, reduceMotion, targetProgress, targetScore]);

  return <figure
    className={`intelligent-score-visual is-${size} ${hasScore ? "has-score" : "is-empty"} ${className}`.trim()}
    style={{ "--score-progress": renderedProgress }}
    role="img"
    aria-label={accessibleLabel}
  >
    <span className="intelligent-score-atmosphere" aria-hidden="true" />
    <svg className="intelligent-score-instrument" viewBox="0 0 220 220" aria-hidden="true">
      <defs>
        <linearGradient id={`score-arc-${visualId}`} x1="24" y1="32" x2="196" y2="188" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f1dda0" />
          <stop offset=".48" stopColor="#c9a54a" />
          <stop offset="1" stopColor="#8f6b1b" />
        </linearGradient>
        <radialGradient id={`score-core-${visualId}`} cx="38%" cy="30%" r="75%">
          <stop offset="0" stopColor="currentColor" stopOpacity=".13" />
          <stop offset=".58" stopColor="currentColor" stopOpacity=".025" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
        <filter id={`score-glow-${visualId}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle className="intelligent-score-field" cx="110" cy="110" r="77" fill={`url(#score-core-${visualId})`} />
      <circle className="intelligent-score-orbit orbit-one" cx="110" cy="110" r="105" />
      <circle className="intelligent-score-orbit orbit-two" cx="110" cy="110" r="73" />
      <circle className="intelligent-score-track-edge" cx="110" cy="110" r="92" />
      <circle className="intelligent-score-track" cx="110" cy="110" r="92" pathLength="100" />
      <circle className="intelligent-score-arc" cx="110" cy="110" r="92" pathLength="100" stroke={`url(#score-arc-${visualId})`} />
      {hasScore && renderedProgress > 0 ? <g className="intelligent-score-endpoint" filter={`url(#score-glow-${visualId})`}>
        <circle cx={endpoint.x} cy={endpoint.y} r="4.4" />
        <circle className="intelligent-score-endpoint-core" cx={endpoint.x} cy={endpoint.y} r="1.8" />
      </g> : null}
      {Array.from({ length: total }, (_, index) => {
        const point = getScorePoint(total === 1 ? 0 : (index / total) * 100, 105);
        return <circle key={index} className={`intelligent-score-node ${index < evaluated ? "is-evaluated" : "is-pending"}`} cx={point.x} cy={point.y} r={index < evaluated ? 2.1 : 1.7} />;
      })}
    </svg>
    <span className="intelligent-score-core" aria-hidden="true" />
    <figcaption className="intelligent-score-value">
      {hasScore ? <><strong>{displayScoreText}</strong><span>/ {maxScore}</span></> : <><strong>—</strong><span>{emptyLabel}</span></>}
    </figcaption>
    {totalAreas > 0 ? <span className="intelligent-score-structure" aria-hidden="true">{evaluatedAreas}/{totalAreas}</span> : null}
  </figure>;
}
