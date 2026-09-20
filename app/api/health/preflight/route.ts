import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

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

async function checkGitHub(repo: string | null) {
  const token = process.env.KORBEN_GITHUB_TOKEN || process.env.GITHUB_TOKEN;

  if (!repo) {
    return { status: "not_configured", detail: "No repository bound to this project." };
  }

  if (!token) {
    return { status: "not_configured", detail: "GitHub runtime credential is missing." };
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });

    return response.ok
      ? { status: "healthy", detail: `Authorized for ${repo}.` }
      : { status: "error", detail: `GitHub returned HTTP ${response.status}.` };
  } catch {
    return { status: "error", detail: "GitHub could not be reached." };
  }
}

async function checkVercel(projectId: string | null) {
  const token = process.env.KORBEN_VERCEL_TOKEN || process.env.VERCEL_TOKEN;
  const teamId = process.env.KORBEN_VERCEL_TEAM_ID || process.env.VERCEL_TEAM_ID;

  if (!projectId) {
    return { status: "not_configured", detail: "No Vercel project bound to this project." };
  }

  if (!token || !teamId) {
    return { status: "not_configured", detail: "Vercel runtime credential or team id is missing." };
  }

  try {
    const response = await fetch(
      `https://api.vercel.com/v9/projects/${projectId}?teamId=${encodeURIComponent(teamId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );

    return response.ok
      ? { status: "healthy", detail: `Authorized for Vercel project ${projectId}.` }
      : { status: "error", detail: `Vercel returned HTTP ${response.status}.` };
  } catch {
    return { status: "error", detail: "Vercel could not be reached." };
  }
}

export async function GET(request: Request) {
  const token = bearerToken(request);

  if (!token) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let supabase: ReturnType<typeof serverSupabase>;

  try {
    supabase = serverSupabase(token);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Supabase is unavailable." },
      { status: 503 }
    );
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedProjectId = url.searchParams.get("project_id");

  let projectQuery = supabase
    .from("projects")
    .select("id,name,slug,github_repo,vercel_project_id,status")
    .eq("status", "active");

  if (requestedProjectId) {
    projectQuery = projectQuery.eq("id", requestedProjectId);
  } else {
    projectQuery = projectQuery.eq("slug", "general-workspace");
  }

  const { data: project } = await projectQuery.limit(1).maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Project is unavailable." }, { status: 404 });
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    github,
    vercel,
    agentsResult,
    toolsResult,
    permissionsResult,
    knowledgeResult,
    approvalsResult,
    errorsResult,
  ] = await Promise.all([
    checkGitHub(project.github_repo),
    checkVercel(project.vercel_project_id),
    supabase.from("agents").select("id", { count: "exact", head: true }),
    supabase.from("tools").select("id", { count: "exact", head: true }).eq("status", "available"),
    supabase.from("agent_tool_permissions").select("agent_id", { count: "exact", head: true }).eq("can_execute", true),
    supabase
      .from("knowledge_entries")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .or(`project_id.is.null,project_id.eq.${project.id}`),
    supabase
      .from("approvals")
      .select("id,objectives!inner(project_id)", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("objectives.project_id", project.id),
    supabase
      .from("run_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id)
      .eq("status", "error")
      .gte("created_at", dayAgo),
  ]);

  const checks = [
    {
      key: "openai",
      label: "OpenAI",
      status: process.env.OPENAI_API_KEY ? "healthy" : "not_configured",
      detail: process.env.OPENAI_API_KEY
        ? "Orchestrator and specialist model credential is configured."
        : "OPENAI_API_KEY is missing.",
    },
    {
      key: "supabase",
      label: "Supabase",
      status: "healthy",
      detail: "Authenticated database and RLS access succeeded.",
    },
    { key: "github", label: "GitHub", ...github },
    { key: "vercel", label: "Vercel", ...vercel },
    {
      key: "agents",
      label: "Agent Network",
      status: (agentsResult.count || 0) > 0 ? "healthy" : "error",
      detail: `${agentsResult.count || 0} agents registered.`,
    },
    {
      key: "tools",
      label: "Tool Registry",
      status: (toolsResult.count || 0) > 0 ? "healthy" : "error",
      detail: `${toolsResult.count || 0} tools available · ${permissionsResult.count || 0} executable permissions.`,
    },
    {
      key: "knowledge",
      label: "Brain",
      status: (knowledgeResult.count || 0) > 0 ? "healthy" : "warning",
      detail: `${knowledgeResult.count || 0} active knowledge entries in scope.`,
    },
    {
      key: "approvals",
      label: "Approval Queue",
      status: (approvalsResult.count || 0) > 0 ? "warning" : "healthy",
      detail: `${approvalsResult.count || 0} pending approvals.`,
    },
    {
      key: "runs",
      label: "Recent Runs",
      status: (errorsResult.count || 0) > 0 ? "warning" : "healthy",
      detail: `${errorsResult.count || 0} execution errors in the last 24 hours.`,
    },
  ];

  const overall = checks.some((check) => check.status === "error")
    ? "error"
    : checks.some((check) => check.status === "warning" || check.status === "not_configured")
      ? "degraded"
      : "healthy";

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    overall,
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      github_repo: project.github_repo,
      vercel_project_id: project.vercel_project_id,
    },
    checks,
  });
}
