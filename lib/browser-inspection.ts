import dns from "node:dns/promises";
import net from "node:net";

export const SENTINEL_SYSTEM_KEY = "qa_engineer";
export const BROWSER_TOOL_KEY = "browser.inspect";

export const BROWSER_LIMITS = Object.freeze({
  timeoutMs: 20_000,
  maxActions: 16,
  maxTextBytes: 120_000,
  maxScreenshotBytes: 2_500_000,
  minViewportWidth: 320,
  maxViewportWidth: 1920,
  minViewportHeight: 480,
  maxViewportHeight: 1200,
});

export type BrowserStep = {
  type: "click" | "fill" | "wait_for";
  selector: string;
  value?: string;
  timeout_ms?: number;
};

export type BrowserInspectionInput = {
  url: string;
  viewport?: { width: number; height: number };
  steps?: BrowserStep[];
  screenshot?: boolean;
  text_scale_percent?: number;
};

export function isBlockedAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  const value = address.toLowerCase();
  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb")
  );
}

export function validateInspectionInput(raw: unknown): BrowserInspectionInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Browser inspection parameters must be an object.");
  }

  const input = raw as BrowserInspectionInput;

  if (typeof input.url !== "string" || !input.url.trim()) {
    throw new Error("A target URL is required.");
  }

  if (input.url.length > 2048) {
    throw new Error("Target URL is too long.");
  }

  const url = new URL(input.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error("Only credential-free HTTPS targets on port 443 are permitted.");
  }

  if (
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    net.isIP(url.hostname)
  ) {
    throw new Error("Local and literal-IP targets are not permitted.");
  }

  const viewport = input.viewport || { width: 1280, height: 720 };
  const width = Number(viewport.width);
  const height = Number(viewport.height);

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < BROWSER_LIMITS.minViewportWidth ||
    width > BROWSER_LIMITS.maxViewportWidth ||
    height < BROWSER_LIMITS.minViewportHeight ||
    height > BROWSER_LIMITS.maxViewportHeight
  ) {
    throw new Error("Viewport is outside the permitted bounds.");
  }

  const steps = input.steps || [];
  if (!Array.isArray(steps) || steps.length > BROWSER_LIMITS.maxActions) {
    throw new Error("Too many browser steps.");
  }

  for (const step of steps) {
    if (!["click", "fill", "wait_for"].includes(step.type)) {
      throw new Error("Unsupported browser step.");
    }
    if (typeof step.selector !== "string" || !step.selector || step.selector.length > 500) {
      throw new Error("Invalid browser selector.");
    }
    if (step.value && step.value.length > 2000) {
      throw new Error("Browser fill value is too large.");
    }
    if (
      step.timeout_ms !== undefined &&
      (!Number.isInteger(step.timeout_ms) || step.timeout_ms < 1 || step.timeout_ms > 3000)
    ) {
      throw new Error("Browser step timeout is outside the permitted bounds.");
    }
  }

  const textScale = Number(input.text_scale_percent || 100);
  if (![100, 125, 150, 175, 200].includes(textScale)) {
    throw new Error("Text scale must be one of 100, 125, 150, 175, or 200 percent.");
  }

  return {
    url: url.toString(),
    viewport: { width, height },
    steps,
    screenshot: Boolean(input.screenshot),
    text_scale_percent: textScale,
  };
}

export async function assertPublicHostname(url: URL) {
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });

  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error("Private, loopback, link-local, carrier-grade NAT, metadata, and reserved networks are blocked.");
  }
}
