import chromium from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright-core";
import { getVercelOidcToken } from "@vercel/oidc";
import {
  assertPublicHostname,
  BROWSER_LIMITS,
  type BrowserInspectionInput,
  validateInspectionInput,
} from "./browser-inspection";

export type BrowserInspectionResult = {
  url: string;
  title: string;
  status: number | null;
  viewport: { width: number; height: number };
  text_scale_percent: number;
  body_text: string;
  horizontal_overflow_px: number;
  overflow_elements: Array<{
    tag: string;
    id: string;
    classes: string;
    left: number;
    right: number;
    width: number;
  }>;
  console_errors: string[];
  page_errors: string[];
  blocked_requests: Array<{ url: string; reason: string }>;
  qa_auth: "not_configured" | "not_needed" | "attempted" | "succeeded" | "failed";
  screenshot_base64: string | null;
};

function normalizeOrigins(origins: string[]) {
  return [...new Set(origins.map((value) => new URL(value).origin))];
}

async function protectedPreviewHeaders() {
  const headers: Record<string, string> = {};

  try {
    const oidcToken = await getVercelOidcToken({
      project: process.env.VERCEL_PROJECT_ID || undefined,
      team: process.env.VERCEL_TEAM_ID || undefined,
      expirationBufferMs: 60_000,
    });

    if (oidcToken) {
      headers["x-vercel-trusted-oidc-idp-token"] = oidcToken;
    }
  } catch {
    // Fall back to an explicitly configured automation bypass secret below.
  }

  const bypassSecret = process.env.KORBEN_VERCEL_PROTECTION_BYPASS;
  if (bypassSecret) {
    headers["x-vercel-protection-bypass"] = bypassSecret;
    headers["x-vercel-set-bypass-cookie"] = "true";
  }

  return headers;
}

async function signInToKorbenPreview(
  page: import("playwright-core").Page
): Promise<"not_configured" | "not_needed" | "succeeded"> {
  const email = process.env.KORBEN_QA_EMAIL;
  const password = process.env.KORBEN_QA_PASSWORD;

  if (!email || !password) {
    return "not_configured";
  }

  const signInHeading = page.getByRole("heading", { name: "Sign in to Korben." });
  await signInHeading.waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);

  const visible = await signInHeading.isVisible().catch(() => false);
  if (!visible) {
    return "not_needed";
  }

  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Enter Korben" }).click();

  await signInHeading
    .waitFor({ state: "hidden", timeout: 10_000 })
    .catch(() => undefined);

  if (await signInHeading.isVisible().catch(() => false)) {
    const authError = await page
      .locator(".auth-error")
      .innerText()
      .catch(() => "QA sign-in did not complete.");
    throw new Error(`Korben QA sign-in failed: ${authError.slice(0, 500)}`);
  }

  await page.waitForTimeout(500);
  return "succeeded";
}

export async function runBrowserInspection(
  raw: unknown,
  allowedOrigins: string[]
): Promise<BrowserInspectionResult> {
  const input: BrowserInspectionInput = validateInspectionInput(raw);
  const origins = normalizeOrigins(allowedOrigins);
  const requestOrigins = new Set(origins);

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://gojgwlnoefbpfvuffxof.supabase.co";
  const supabaseOrigin = new URL(supabaseUrl).origin;
  await assertPublicHostname(new URL(supabaseOrigin));
  requestOrigins.add(supabaseOrigin);

  if (!origins.length) {
    throw new Error("No browser origins are authorized for this project.");
  }

  const target = new URL(input.url);
  if (!origins.includes(target.origin)) {
    throw new Error("Target origin is outside the selected project's browser allowlist.");
  }

  await assertPublicHostname(target);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BROWSER_LIMITS.timeoutMs);

  const browser = await playwrightChromium.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const previewHeaders = await protectedPreviewHeaders();
    const blockedRequests: Array<{ url: string; reason: string }> = [];
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      viewport: input.viewport,
      javaScriptEnabled: true,
    });

    context.setDefaultTimeout(8000);
    context.setDefaultNavigationTimeout(BROWSER_LIMITS.timeoutMs);

    await context.route("**/*", async (route) => {
      try {
        const requestUrl = new URL(route.request().url());

        if (!["https:", "data:", "blob:"].includes(requestUrl.protocol)) {
          if (blockedRequests.length < 30) {
            blockedRequests.push({ url: requestUrl.toString(), reason: "protocol_not_allowed" });
          }
          await route.abort("blockedbyclient");
          return;
        }

        if (["data:", "blob:"].includes(requestUrl.protocol)) {
          await route.continue();
          return;
        }

        if (!requestOrigins.has(requestUrl.origin)) {
          if (blockedRequests.length < 30) {
            blockedRequests.push({ url: requestUrl.toString(), reason: "origin_not_allowed" });
          }
          await route.abort("blockedbyclient");
          return;
        }

        await assertPublicHostname(requestUrl);

        if (origins.includes(requestUrl.origin)) {
          await route.continue({
            headers: {
              ...route.request().headers(),
              ...previewHeaders,
            },
          });
          return;
        }

        await route.continue();
      } catch (error) {
        if (blockedRequests.length < 30) {
          blockedRequests.push({
            url: route.request().url(),
            reason: error instanceof Error ? `validation_failed: ${error.message}` : "validation_failed",
          });
        }
        await route.abort("blockedbyclient");
      }
    });

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error" && consoleErrors.length < 30) {
        consoleErrors.push(message.text().slice(0, 2000));
      }
    });

    page.on("pageerror", (error) => {
      if (pageErrors.length < 20) {
        pageErrors.push(error.message.slice(0, 2000));
      }
    });

    const response = await page.goto(input.url, {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_LIMITS.timeoutMs,
    });

    if (controller.signal.aborted) {
      throw new Error("Browser inspection timed out.");
    }

    const finalUrl = new URL(page.url());
    if (!origins.includes(finalUrl.origin)) {
      throw new Error("Browser navigation left the authorized project origin.");
    }

    await assertPublicHostname(finalUrl);
    let qaAuth: BrowserInspectionResult["qa_auth"] = "not_needed";
    try {
      const authResult = await signInToKorbenPreview(page);
      qaAuth = authResult === "succeeded" ? "succeeded" : authResult;
    } catch (error) {
      qaAuth = "failed";
      throw error;
    }

    if ((input.text_scale_percent || 100) !== 100) {
      const scale = (input.text_scale_percent || 100) / 100;
      await page.addStyleTag({
        content: `
          html { font-size: calc(100% * ${scale}) !important; }
          body { text-size-adjust: ${input.text_scale_percent}%; -webkit-text-size-adjust: ${input.text_scale_percent}%; }
        `,
      });
    }

    for (const step of input.steps || []) {
      if (controller.signal.aborted) {
        throw new Error("Browser inspection timed out.");
      }

      const timeout = step.timeout_ms || 3000;
      const locator = page.locator(step.selector).first();

      if (step.type === "click") {
        await locator.click({ timeout });
      } else if (step.type === "fill") {
        await locator.fill(step.value || "", { timeout });
      } else if (step.type === "wait_for") {
        await locator.waitFor({ timeout, state: "visible" });
      }

      const afterStepUrl = new URL(page.url());
      if (!origins.includes(afterStepUrl.origin)) {
        throw new Error("A browser step navigated outside the authorized project origin.");
      }
    }

    await page.waitForTimeout(250);

    const title = (await page.title()).slice(0, 1000);
    const bodyText = (await page.locator("body").innerText()).slice(
      0,
      BROWSER_LIMITS.maxTextBytes
    );

    const layout = await page.evaluate(() => {
      const viewportWidth = window.innerWidth;
      const doc = document.documentElement;
      const horizontalOverflowPx = Math.max(0, doc.scrollWidth - viewportWidth);

      const overflowElements = Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            id: element.id || "",
            classes:
              typeof element.className === "string"
                ? element.className.slice(0, 300)
                : "",
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              getComputedStyle(element).visibility !== "hidden",
          };
        })
        .filter(
          (entry) =>
            entry.visible &&
            (entry.left < -1 || entry.right > viewportWidth + 1)
        )
        .slice(0, 40)
        .map(({ visible: _visible, ...entry }) => entry);

      return { horizontalOverflowPx, overflowElements };
    });

    let screenshotBase64: string | null = null;

    if (input.screenshot) {
      try {
        const screenshot = await page.screenshot({
          type: "png",
          fullPage: false,
          animations: "disabled",
          timeout: 8000,
        });

        if (screenshot.byteLength <= BROWSER_LIMITS.maxScreenshotBytes) {
          screenshotBase64 = screenshot.toString("base64");
        }
      } catch {
        // Screenshot capture is best-effort. Preserve DOM/layout/console findings
        // instead of failing the entire inspection on a slow visual artifact.
        screenshotBase64 = null;
      }
    }

    return {
      url: page.url(),
      title,
      status: response?.status() || null,
      viewport: input.viewport || { width: 1280, height: 720 },
      text_scale_percent: input.text_scale_percent || 100,
      body_text: bodyText,
      horizontal_overflow_px: layout.horizontalOverflowPx,
      overflow_elements: layout.overflowElements,
      console_errors: consoleErrors,
      page_errors: pageErrors,
      blocked_requests: blockedRequests,
      qa_auth: qaAuth,
      screenshot_base64: screenshotBase64,
    };
  } finally {
    clearTimeout(timer);
    await browser.close().catch(() => undefined);
  }
}
