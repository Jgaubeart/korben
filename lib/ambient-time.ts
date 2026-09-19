export type AmbientSceneKey =
  | "pre-dawn"
  | "dawn"
  | "sunrise"
  | "morning"
  | "noon"
  | "afternoon"
  | "golden-hour"
  | "sunset"
  | "blue-hour"
  | "night";

export type AmbientSceneDefinition = {
  key: AmbientSceneKey;
  minute: number;
  src: string;
  warmth: number;
  brightness: number;
};

export type AmbientState = {
  current: AmbientSceneDefinition;
  next: AmbientSceneDefinition;
  previous: AmbientSceneDefinition;
  progress: number;
  daylightProgress: number;
  nightProgress: number;
  sunVisible: number;
  moonVisible: number;
  starOpacity: number;
  warmth: number;
  brightness: number;
  isNight: boolean;
};

export const AMBIENT_SCENES: AmbientSceneDefinition[] = [
  { key: "pre-dawn", minute: 300, src: "/ambient/01-pre-dawn.webp", warmth: 0.12, brightness: 0.62 },
  { key: "dawn", minute: 360, src: "/ambient/02-dawn.webp", warmth: 0.34, brightness: 0.76 },
  { key: "sunrise", minute: 420, src: "/ambient/03-sunrise.webp", warmth: 0.72, brightness: 0.94 },
  { key: "morning", minute: 540, src: "/ambient/04-morning.webp", warmth: 0.34, brightness: 1 },
  { key: "noon", minute: 720, src: "/ambient/05-noon.webp", warmth: 0.16, brightness: 1.03 },
  { key: "afternoon", minute: 900, src: "/ambient/06-afternoon.webp", warmth: 0.28, brightness: 1 },
  { key: "golden-hour", minute: 1050, src: "/ambient/07-golden-hour.webp", warmth: 0.68, brightness: 0.94 },
  { key: "sunset", minute: 1140, src: "/ambient/08-sunset.webp", warmth: 0.88, brightness: 0.84 },
  { key: "blue-hour", minute: 1200, src: "/ambient/09-blue-hour.webp", warmth: 0.18, brightness: 0.68 },
  { key: "night", minute: 1320, src: "/ambient/10-night.webp", warmth: 0.04, brightness: 0.5 },
];

const DAY_MINUTES = 24 * 60;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;

function minutesFor(date: Date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

export function getAmbientState(date: Date): AmbientState {
  const minute = minutesFor(date);

  let currentIndex = AMBIENT_SCENES.length - 1;
  for (let index = 0; index < AMBIENT_SCENES.length; index += 1) {
    if (minute >= AMBIENT_SCENES[index].minute) currentIndex = index;
  }

  // Midnight through pre-dawn belongs to the night -> pre-dawn bridge.
  if (minute < AMBIENT_SCENES[0].minute) currentIndex = AMBIENT_SCENES.length - 1;

  const nextIndex = (currentIndex + 1) % AMBIENT_SCENES.length;
  const previousIndex = (currentIndex - 1 + AMBIENT_SCENES.length) % AMBIENT_SCENES.length;
  const current = AMBIENT_SCENES[currentIndex];
  const next = AMBIENT_SCENES[nextIndex];

  let currentMinute = current.minute;
  let nextMinute = next.minute;
  let effectiveMinute = minute;

  if (nextIndex === 0) nextMinute += DAY_MINUTES;
  if (effectiveMinute < currentMinute) effectiveMinute += DAY_MINUTES;

  const span = Math.max(1, nextMinute - currentMinute);
  const progress = clamp01((effectiveMinute - currentMinute) / span);

  // Fixed first-pass day arc. This is intentionally clock based, not a looping animation.
  const sunrise = 390; // 6:30 AM
  const sunset = 1170; // 7:30 PM
  const daylightProgress = clamp01((minute - sunrise) / (sunset - sunrise));
  const isNight = minute < sunrise || minute >= sunset;

  const nightStart = sunset;
  const nightEnd = sunrise + DAY_MINUTES;
  const nightMinute = minute < sunrise ? minute + DAY_MINUTES : minute;
  const nightProgress = clamp01((nightMinute - nightStart) / (nightEnd - nightStart));

  const dawnFade = clamp01((minute - (sunrise - 45)) / 45);
  const duskFade = 1 - clamp01((minute - sunset) / 45);
  // Let the celestial bodies overlap softly through dawn and dusk instead of
  // snapping from sun to moon at the exact night boundary.
  const sunVisible = Math.min(dawnFade, duskFade);
  const moonVisible =
    minute >= sunset - 30
      ? clamp01((minute - (sunset - 30)) / 60)
      : minute < sunrise + 30
        ? 1 - clamp01((minute - (sunrise - 30)) / 60)
        : 0;
  const starOpacity = isNight
    ? minute >= sunset
      ? clamp01((minute - sunset) / 75)
      : 1 - clamp01((minute - (sunrise - 75)) / 75)
    : 0;

  return {
    current,
    next,
    previous: AMBIENT_SCENES[previousIndex],
    progress,
    daylightProgress,
    nightProgress,
    sunVisible,
    moonVisible,
    starOpacity,
    warmth: lerp(current.warmth, next.warmth, progress),
    brightness: lerp(current.brightness, next.brightness, progress),
    isNight,
  };
}

export function getGreetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function getSimulatedTime(value: string | null) {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  const simulated = new Date();
  simulated.setHours(hours, minutes, 0, 0);
  return simulated;
}
