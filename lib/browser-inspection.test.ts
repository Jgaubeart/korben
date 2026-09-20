import test from "node:test";
import assert from "node:assert/strict";
import {
  BROWSER_LIMITS,
  BROWSER_TOOL_KEY,
  SENTINEL_SYSTEM_KEY,
  isBlockedAddress,
  validateInspectionInput,
} from "./browser-inspection.ts";

test("browser capability is bound to Sentinel canonical identity", () => {
  assert.equal(SENTINEL_SYSTEM_KEY, "qa_engineer");
  assert.equal(BROWSER_TOOL_KEY, "browser.inspect");
});

test("rejects non-HTTPS and credentialed targets", () => {
  assert.throws(
    () => validateInspectionInput({ url: "http://example.com" }),
    /HTTPS/
  );
  assert.throws(
    () => validateInspectionInput({ url: "https://user:pass@example.com" }),
    /HTTPS/
  );
});

test("rejects localhost and literal IP hosts", () => {
  assert.throws(
    () => validateInspectionInput({ url: "https://localhost" }),
    /Local/
  );
  assert.throws(
    () => validateInspectionInput({ url: "https://127.0.0.1" }),
    /Local/
  );
});

test("blocks private, loopback, link-local, and CGNAT addresses", () => {
  for (const address of [
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.2",
    "100.64.0.1",
    "::1",
    "fd00::1",
  ]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  assert.equal(isBlockedAddress("8.8.8.8"), false);
});

test("bounds browser actions and disallows script/evaluate steps", () => {
  assert.throws(
    () =>
      validateInspectionInput({
        url: "https://example.com",
        steps: [{ type: "evaluate", selector: "*" }],
      }),
    /Unsupported/
  );

  assert.throws(
    () =>
      validateInspectionInput({
        url: "https://example.com",
        steps: Array.from({ length: BROWSER_LIMITS.maxActions + 1 }, () => ({
          type: "click",
          selector: "button",
        })),
      }),
    /Too many/
  );
});

test("bounds viewport, timeout, and text scaling", () => {
  assert.throws(
    () =>
      validateInspectionInput({
        url: "https://example.com",
        viewport: { width: 200, height: 900 },
      }),
    /Viewport/
  );
  assert.throws(
    () =>
      validateInspectionInput({
        url: "https://example.com",
        steps: [{ type: "wait_for", selector: "body", timeout_ms: 3001 }],
      }),
    /timeout/
  );
  assert.throws(
    () =>
      validateInspectionInput({
        url: "https://example.com",
        text_scale_percent: 300,
      }),
    /Text scale/
  );
});
