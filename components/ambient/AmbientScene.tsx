"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AMBIENT_SCENES,
  getAmbientState,
  getSimulatedTime,
} from "../../lib/ambient-time";
import { AmbientMist } from "./AmbientMist";
import { AtmosphereOverlay } from "./AtmosphereOverlay";
import { CelestialBody } from "./CelestialBody";

type AmbientSceneProps = {
  className?: string;
};

function resolveNow() {
  if (typeof window === "undefined") return new Date(2026, 8, 19, 12, 0, 0);
  const simulated = getSimulatedTime(
    new URLSearchParams(window.location.search).get("ambientTime")
  );
  return simulated || new Date();
}

export function AmbientScene({ className = "" }: AmbientSceneProps) {
  const [now, setNow] = useState(resolveNow);
  const state = useMemo(() => getAmbientState(now), [now]);

  useEffect(() => {
    const update = () => setNow(resolveNow());
    update();
    const interval = window.setInterval(update, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.ambientTone = state.isNight ? "night" : state.current.key;
    return () => {
      delete document.documentElement.dataset.ambientTone;
    };
  }, [state.current.key, state.isNight]);

  useEffect(() => {
    [state.previous.src, state.current.src, state.next.src].forEach((src) => {
      const image = new Image();
      image.src = src;
    });
  }, [state.current.src, state.next.src, state.previous.src]);

  const currentOpacity = Math.max(0, 1 - state.progress);
  const nextOpacity = Math.min(1, state.progress);

  return (
    <div
      className={`ambient-scene ${className}`}
      aria-hidden="true"
      data-scene={state.current.key}
      data-next-scene={state.next.key}
    >
      <div
        className="ambient-image-layer"
        style={{
          backgroundImage: `url("${state.current.src}")`,
          opacity: currentOpacity,
        }}
      />
      <div
        className="ambient-image-layer"
        style={{
          backgroundImage: `url("${state.next.src}")`,
          opacity: nextOpacity,
        }}
      />

      <AtmosphereOverlay
        warmth={state.warmth}
        brightness={state.brightness}
        starOpacity={state.starOpacity}
        isNight={state.isNight}
      />

      <CelestialBody
        kind="sun"
        progress={state.daylightProgress}
        opacity={state.sunVisible}
      />
      <CelestialBody
        kind="moon"
        progress={state.nightProgress}
        opacity={state.moonVisible}
      />

      <AmbientMist />

      <div className="ambient-scene-label">
        {AMBIENT_SCENES.find((scene) => scene.key === state.current.key)?.key}
      </div>
    </div>
  );
}
