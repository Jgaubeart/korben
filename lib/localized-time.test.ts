import assert from "node:assert/strict";
import test from "node:test";
import { createLocalizedTimeContext } from "./localized-time.ts";

test("Cape Coral uses America/New_York with automatic DST", () => {
  const winter = createLocalizedTimeContext(
    new Date("2026-01-15T17:00:00.000Z"),
    "America/New_York"
  );
  const summer = createLocalizedTimeContext(
    new Date("2026-07-15T16:00:00.000Z"),
    "America/New_York"
  );

  assert.equal(winter.status, "ok");
  assert.equal(winter.utcOffset, "GMT-05:00");
  assert.match(winter.localizedDateTime ?? "", /12:00:00 PM/);
  assert.equal(summer.utcOffset, "GMT-04:00");
  assert.match(summer.localizedDateTime ?? "", /12:00:00 PM/);
});

test("other valid IANA time zones are supported", () => {
  const result = createLocalizedTimeContext(
    new Date("2026-01-15T12:00:00.000Z"),
    "Asia/Tokyo"
  );

  assert.equal(result.status, "ok");
  assert.equal(result.timeZone, "Asia/Tokyo");
  assert.match(result.localizedDateTime ?? "", /9:00:00 PM/);
});

test("missing and invalid zones expose UTC without inventing local time", () => {
  for (const zone of [undefined, "Not/A_Zone"]) {
    const result = createLocalizedTimeContext(
      new Date("2026-01-15T12:00:00.000Z"),
      zone
    );

    assert.notEqual(result.status, "ok");
    assert.equal(result.localizedDateTime, null);
    assert.equal(result.trustedUtc, "2026-01-15T12:00:00.000Z");
    assert.match(result.fallback ?? "", /do not invent a local time/i);
  }
});
