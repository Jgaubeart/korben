type AtmosphereOverlayProps = {
  warmth: number;
  brightness: number;
  starOpacity: number;
  isNight: boolean;
};

export function AtmosphereOverlay({
  warmth,
  brightness,
  starOpacity,
  isNight,
}: AtmosphereOverlayProps) {
  return (
    <>
      <div
        className="ambient-light-wash"
        aria-hidden="true"
        style={{
          opacity: Math.min(0.22, warmth * 0.2),
          filter: `brightness(${brightness})`,
        }}
      />
      <div
        className="ambient-stars"
        aria-hidden="true"
        style={{ opacity: starOpacity }}
      />
      <div
        className={`ambient-vignette ${isNight ? "night" : ""}`}
        aria-hidden="true"
      />
      <div className="ambient-water-shimmer" aria-hidden="true" />
    </>
  );
}
