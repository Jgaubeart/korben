export const CAPE_CORAL_TIME_ZONE = "America/New_York";

export type LocalizedTimeContext = {
  trustedUtc: string;
  timeZone: string | null;
  localizedDateTime: string | null;
  utcOffset: string | null;
  status: "ok" | "missing_time_zone" | "invalid_time_zone";
  fallback: string | null;
};

const formatterOptions: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "long",
};

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).format();
    return true;
  } catch {
    return false;
  }
}

export function createLocalizedTimeContext(
  instant: Date,
  requestedTimeZone: unknown
): LocalizedTimeContext {
  const trustedUtc = instant.toISOString();
  const timeZone = typeof requestedTimeZone === "string" ? requestedTimeZone.trim() : "";

  if (!timeZone) {
    return {
      trustedUtc,
      timeZone: null,
      localizedDateTime: null,
      utcOffset: null,
      status: "missing_time_zone",
      fallback: "The user's time zone is unavailable. State the trusted UTC time and ask for a valid IANA time zone; do not invent a local time.",
    };
  }

  if (!isValidTimeZone(timeZone)) {
    return {
      trustedUtc,
      timeZone: null,
      localizedDateTime: null,
      utcOffset: null,
      status: "invalid_time_zone",
      fallback: `The supplied time zone (${timeZone}) is invalid. State the trusted UTC time and ask for a valid IANA time zone; do not invent a local time.`,
    };
  }

  const localizedDateTime = new Intl.DateTimeFormat("en-US", {
    ...formatterOptions,
    timeZone,
  }).format(instant);
  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;

  return {
    trustedUtc,
    timeZone,
    localizedDateTime,
    utcOffset: offsetPart ?? null,
    status: "ok",
    fallback: null,
  };
}
