import { NextResponse } from "next/server";

export async function GET() {
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
    vercel_team: Boolean(
      process.env.KORBEN_VERCEL_TEAM_ID ||
      process.env.VERCEL_TEAM_ID
    ),
    gbrain: Boolean(process.env.KORBEN_GBRAIN_URL),
    obsidian: Boolean(process.env.KORBEN_OBSIDIAN_BRIDGE_URL),
  });
}
