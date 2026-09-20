import { chromium } from "playwright";
import { assertPublicHttpsTarget, LIMITS, validateInspection } from "./browser-inspection";

export async function runInspection(action: string, raw: unknown) {
  const input = validateInspection(action, raw);
  const allowed = new Set(input.allowed_origins.map(value => new URL(value).origin));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.timeoutMs);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await assertPublicHttpsTarget(input.url, input.allowed_origins);
    browser = await chromium.launch({ headless: true, chromiumSandbox: true, args: ["--disable-dev-shm-usage", "--disable-extensions", "--disable-background-networking", "--no-first-run"] });
    const context = await browser.newContext({ acceptDownloads: false, javaScriptEnabled: true, serviceWorkers: "block", viewport: { width: 1280, height: 720 } });
    context.setDefaultTimeout(3000);
    await context.route("**/*", async route => {
      try {
        const requestUrl = route.request().url();
        const target = await assertPublicHttpsTarget(requestUrl, [...allowed]);
        if (!allowed.has(target.origin)) return route.abort("blockedbyclient");
        return route.continue();
      } catch { return route.abort("blockedbyclient"); }
    });
    const page = await context.newPage();
    const response = await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: LIMITS.timeoutMs });
    if (controller.signal.aborted) throw new Error("Browser inspection timed out.");
    await assertPublicHttpsTarget(page.url(), input.allowed_origins);
    for (const step of input.steps || []) {
      if (step.type === "click") await page.locator(step.selector).click({ timeout: step.timeout_ms || 3000 });
      if (step.type === "fill") await page.locator(step.selector).fill(step.value || "", { timeout: step.timeout_ms || 3000 });
      if (step.type === "wait_for") await page.locator(step.selector).waitFor({ timeout: step.timeout_ms || 3000 });
      if (controller.signal.aborted) throw new Error("Browser inspection timed out.");
    }
    const title = (await page.title()).slice(0, 1000);
    const text = (await page.locator("body").innerText()).slice(0, LIMITS.maxTextBytes);
    const screenshot = input.screenshot ? await page.screenshot({ type: "png", fullPage: false }) : undefined;
    if (screenshot && screenshot.byteLength > LIMITS.maxScreenshotBytes) throw new Error("Screenshot exceeds the artifact limit.");
    return { url: page.url(), status: response?.status() || null, title, text, screenshot_base64: screenshot?.toString("base64") || null };
  } finally { clearTimeout(timer); await browser?.close().catch(() => undefined); }
}
