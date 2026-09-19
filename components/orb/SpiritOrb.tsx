"use client";

import type { AmbientSceneKey } from "../../lib/ambient-time";

type SpiritOrbProps = {
  state: "idle" | "listening" | "thinking" | "responding" | "working";
  tone: AmbientSceneKey;
};

const toneClass: Record<AmbientSceneKey, string> = {
  "pre-dawn": "orb-tone-pre-dawn",
  dawn: "orb-tone-dawn",
  sunrise: "orb-tone-sunrise",
  morning: "orb-tone-morning",
  noon: "orb-tone-noon",
  afternoon: "orb-tone-afternoon",
  "golden-hour": "orb-tone-golden-hour",
  sunset: "orb-tone-sunset",
  "blue-hour": "orb-tone-blue-hour",
  night: "orb-tone-night",
};

export function SpiritOrb({ state, tone }: SpiritOrbProps) {
  return (
    <div className={`simple-glass-orb ${state} ${toneClass[tone]}`} aria-hidden="true">
      <span className="simple-glass-orb-glow" />
      <img
        src="/ambient/korben-orb.webp"
        alt=""
        className="simple-glass-orb-image"
        draggable={false}
      />
    </div>
  );
}
