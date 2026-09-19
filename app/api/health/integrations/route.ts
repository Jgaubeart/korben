import { NextResponse } from "next/server";

async function checkGitHub() {
  const token = process.env.KORBEN_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return { configured: false, authorized: false };

  try {
    const response = await fetch("https://api.github.com/repos/Jgaubeart/korben", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });

    return { configured: true, authorized: response.ok };
  } catch {
    return { configured: true, authorized: false };
  }
}

async function checkVercel() {
  const token = process.env.KORBEN_VERCEL_TOKEN || process.env.VERCEL_TOKEN;
  const teamId =
    process.env.KORBEN_VERCEL_TEAM_ID || process.env.VERCEL_TEAM_ID;

  if (!token || !teamId) {
    return { configured: false, authorized: false };
  }

  try {
    const projectId = "prj_WBhAWe7N7VazzaNdUumb87vdvZdr";
    const response = await fetch(
      `https://api.vercel.com/v9/projects/${projectId}?teamId=${encodeURIComponent(teamId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );

    return { configured: true, authorized: response.ok };
  } catch {
    return { configured: true, authorized: false };
  }
}

export async function GET() {
  const [github, vercel] = await Promise.all([
    checkGitHub(),
    checkVercel(),
  ]);

  return NextResponse.json({
    openai: Boolean(process.env.OPENAI_API_KEY),
    supabase: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ),
    github,
    vercel,
    vercel_team: Boolean(
      process.env.KORBEN_VERCEL_TEAM_ID ||
      process.env.VERCEL_TEAM_ID
    ),
    gbrain: Boolean(process.env.KORBEN_GBRAIN_URL),
    obsidian: Boolean(process.env.KORBEN_OBSIDIAN_BRIDGE_URL),
  });
}
