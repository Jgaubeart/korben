import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export async function GET(request: Request) {
  const token = bearerToken(request);

  if (!token) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return NextResponse.json(
      { error: "Supabase runtime configuration is missing." },
      { status: 503 }
    );
  }

  const supabase = createClient(url, key, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  return NextResponse.json({
    openai: Boolean(process.env.OPENAI_API_KEY),
    supabase: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ),
    github: Boolean(
      process.env.KORBEN_GITHUB_TOKEN ||
      process.env.GITHUB_TOKEN
    ),
    vercel: Boolean(
      process.env.KORBEN_VERCEL_TOKEN ||
      process.env.VERCEL_TOKEN
    ),
    gbrain: Boolean(process.env.KORBEN_GBRAIN_URL),
    obsidian: Boolean(process.env.KORBEN_OBSIDIAN_BRIDGE_URL),
  });
}
