import "./OrbSphere.css";

const VALID_STATES = new Set(["resting", "listening", "thinking", "executing", "complete"]);

export default function OrbSphere({ size = 48, state = "resting", className = "" }) {
  const visualState = VALID_STATES.has(state) ? state : "resting";
  return <span className={`orb-sphere is-${visualState} ${className}`.trim()} style={{ "--orb-sphere-size": `${size}px` }} aria-hidden="true">
    <span className="orb-sphere-halo" />
    <span className="orb-sphere-shell">
      <span className="orb-sphere-core" />
      <span className="orb-sphere-refraction" />
      <span className="orb-sphere-light" />
      <img className="orb-sphere-symbol" src="/orvesen-mark.png" alt="" />
      <span className="orb-sphere-reflection" />
      <span className="orb-sphere-caustic" />
      <span className="orb-sphere-rim" />
    </span>
  </span>;
}
