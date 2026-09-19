"use client";

type CelestialBodyProps = {
  kind: "sun" | "moon";
  progress: number;
  opacity: number;
};

export function CelestialBody({ kind, progress, opacity }: CelestialBodyProps) {
  const x = 8 + progress * 84;
  const y = 30 - Math.sin(progress * Math.PI) * 22;

  return (
    <span
      aria-hidden="true"
      className={`ambient-celestial ambient-${kind}`}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        opacity,
      }}
    >
      <span className="ambient-celestial-core" />
    </span>
  );
}
