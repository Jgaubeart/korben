import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, SENTINEL_SYSTEM_KEY, validateInspection } from "./browser-inspection";

test("capability is bound to Sentinel canonical identity", () => assert.equal(SENTINEL_SYSTEM_KEY, "qa_engineer"));
test("rejects arbitrary Playwright actions", () => assert.throws(() => validateInspection("evaluate", { url: "https://example.com", allowed_origins: ["https://example.com"] }), /Unsupported/));
test("rejects shell-like or script steps", () => assert.throws(() => validateInspection("inspect", { url: "https://example.com", allowed_origins: ["https://example.com"], steps: [{ type: "evaluate", selector: "*" }] }), /Invalid/));
test("bounds action count", () => assert.throws(() => validateInspection("inspect", { url: "https://example.com", allowed_origins: ["https://example.com"], steps: Array.from({ length: LIMITS.maxActions + 1 }, () => ({ type: "click", selector: "button" })) }), /Too many/));
test("bounds per-step timeout", () => assert.throws(() => validateInspection("inspect", { url: "https://example.com", allowed_origins: ["https://example.com"], steps: [{ type: "wait_for", selector: "body", timeout_ms: 3001 }] }), /out of bounds/));
