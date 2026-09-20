import dns from "node:dns/promises";
import net from "node:net";

export const SENTINEL_SYSTEM_KEY = "qa_engineer";
export const BROWSER_TOOL_KEY = "browser.inspect";
export const LIMITS = Object.freeze({ timeoutMs: 15_000, maxActions: 20, maxTextBytes: 100_000, maxScreenshotBytes: 2_000_000 });
export const ALLOWED_ACTIONS = new Set(["inspect"]);
export const ALLOWED_STEPS = new Set(["click", "fill", "wait_for"]);

export type InspectionInput = { url: string; allowed_origins: string[]; steps?: Array<{ type: string; selector: string; value?: string; timeout_ms?: number }>; screenshot?: boolean };

function blockedIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a,b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const value = ip.toLowerCase();
  return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb");
}

export async function assertPublicHttpsTarget(raw: string, allowedOrigins: string[]) {
  if (raw.length > 2048) throw new Error("URL is too long.");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Only credential-free HTTPS targets on port 443 are permitted.");
  const origins = new Set(allowedOrigins.map(value => new URL(value).origin));
  if (!origins.has(url.origin)) throw new Error("Target origin is outside the selected project allowlist.");
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) throw new Error("Local targets are blocked.");
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => blockedIp(address))) throw new Error("Private, loopback, link-local, metadata, and reserved networks are blocked.");
  return url;
}

export function validateInspection(action: string, params: unknown): InspectionInput {
  if (!ALLOWED_ACTIONS.has(action)) throw new Error("Unsupported browser action.");
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Inspection parameters must be an object.");
  const input = params as InspectionInput;
  if (typeof input.url !== "string" || !Array.isArray(input.allowed_origins) || !input.allowed_origins.length) throw new Error("url and allowed_origins are required.");
  if (input.steps && (!Array.isArray(input.steps) || input.steps.length > LIMITS.maxActions)) throw new Error("Too many inspection steps.");
  for (const step of input.steps || []) {
    if (!ALLOWED_STEPS.has(step.type) || typeof step.selector !== "string" || step.selector.length > 500) throw new Error("Invalid inspection step.");
    if (step.value && step.value.length > 2000) throw new Error("Step value is too large.");
    if (step.timeout_ms && (step.timeout_ms < 1 || step.timeout_ms > 3000)) throw new Error("Step timeout is out of bounds.");
  }
  return input;
}
