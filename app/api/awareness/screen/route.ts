import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function serverSupabase(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase runtime configuration is missing.");
  }

  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const supabase = serverSupabase(token);
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Screen awareness is unavailable." }, { status: 503 });
  }

  const body = await request.json();
  const image = String(body?.image || "");

  if (!image.startsWith("data:image/") || image.length > 6_000_000) {
    return NextResponse.json({ error: "A valid screen image is required." }, { status: 400 });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_ORCHESTRATOR_MODEL || "gpt-5.6-sol",
      reasoning: { effort: "none" },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Summarize the user's visible screen for a personal assistant in at most 45 words. Focus on the active app, task, document/page context, obvious state, and actionable cues. Do not infer hidden information. Do not transcribe passwords, tokens, private keys, payment card numbers, or other secrets.",
            },
            {
              type: "input_image",
              image_url: image,
              detail: "low",
            },
          ],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json({ error: "Screen awareness analysis failed." }, { status: 502 });
  }

  const summary =
    payload?.output_text ||
    payload?.output
      ?.flatMap((item: any) => item?.content || [])
      ?.find((item: any) => item?.type === "output_text")
      ?.text ||
    "";

  return NextResponse.json({ summary: String(summary).trim() });
}
