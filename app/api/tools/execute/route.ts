import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type ToolRequest = {
  tool_system_key?: string;
  agent_system_key?: string;
  project_id?: string;
  task_id?: string | null;
  run_id?: string | null;
  approval_id?: string | null;
  action?: string;
  params?: Record<string, any>;
};

const toolRisk: Record<string, number> = {
  "github.read": 0,
  "github.write": 1,
  "github.pr": 1,
  "github.merge": 2,
  "vercel.read": 0,
  "vercel.preview": 1,
  "vercel.production": 3,
  "supabase.read": 0,
  "supabase.sql": 1,
  "supabase.migration": 2,
};

function serverSupabase(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase runtime configuration is missing.");
  }

  return createClient(url, key, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function githubRequest(path: string, init?: RequestInit) {
  const token = process.env.KORBEN_GITHUB_TOKEN || process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error("GitHub runtime token is not configured.");
  }

  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      payload?.message || `GitHub request failed with status ${response.status}.`
    );
  }

  return payload;
}

async function executeGitHub(tool: string, action: string, params: Record<string, any>) {
  const repo = String(params.repo || "");

  if (!repo.includes("/")) {
    throw new Error("A GitHub repo in owner/name form is required.");
  }

  const [owner, name] = repo.split("/");

  if (tool === "github.read") {
    if (action === "repo") {
      return githubRequest(`/repos/${owner}/${name}`);
    }

    if (action === "file") {
      const path = String(params.path || "");
      const ref = params.ref ? `?ref=${encodeURIComponent(String(params.ref))}` : "";
      return githubRequest(
        `/repos/${owner}/${name}/contents/${path.split("/").map(encodeURIComponent).join("/")}${ref}`
      );
    }

    if (action === "branch") {
      return githubRequest(
        `/repos/${owner}/${name}/branches/${encodeURIComponent(String(params.branch || "main"))}`
      );
    }

    if (action === "pull_request") {
      return githubRequest(
        `/repos/${owner}/${name}/pulls/${Number(params.number)}`
      );
    }

    throw new Error("Unsupported GitHub read action.");
  }

  if (tool === "github.write") {
    if (action === "create_branch") {
      const branch = String(params.branch || "");
      const base = String(params.base || "main");

      if (!branch) {
        throw new Error("branch is required.");
      }

      const baseRef = await githubRequest(
        `/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(base)}`
      );

      return githubRequest(`/repos/${owner}/${name}/git/refs`, {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: baseRef.object.sha,
        }),
      });
    }

    if (action === "update_file") {
      const path = String(params.path || "");
      const content = String(params.content ?? "");
      const message = String(params.message || "Update file via Korben");
      const branch = String(params.branch || "");

      if (!path || !branch) {
        throw new Error("path and branch are required.");
      }

      if (["main", "master"].includes(branch.toLowerCase())) {
        throw new Error("L1 GitHub writes cannot target main or master. Use a feature branch.");
      }

      return githubRequest(
        `/repos/${owner}/${name}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
        {
          method: "PUT",
          body: JSON.stringify({
            message,
            content: Buffer.from(content, "utf8").toString("base64"),
            branch,
            ...(params.sha ? { sha: String(params.sha) } : {}),
          }),
        }
      );
    }

    throw new Error("Unsupported GitHub write action.");
  }

  if (tool === "github.pr" && action === "create") {
    return githubRequest(`/repos/${owner}/${name}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: String(params.title || ""),
        head: String(params.head || ""),
        base: String(params.base || "main"),
        body: String(params.body || ""),
        draft: Boolean(params.draft),
      }),
    });
  }

  if (tool === "github.merge" && action === "merge") {
    return githubRequest(
      `/repos/${owner}/${name}/pulls/${Number(params.number)}/merge`,
      {
        method: "PUT",
        body: JSON.stringify({
          commit_title: params.commit_title
            ? String(params.commit_title)
            : undefined,
          merge_method: String(params.merge_method || "squash"),
        }),
      }
    );
  }

  throw new Error("Unsupported GitHub tool/action combination.");
}

async function vercelRequest(path: string, init?: RequestInit) {
  const token = process.env.KORBEN_VERCEL_TOKEN || process.env.VERCEL_TOKEN;

  if (!token) {
    throw new Error("Vercel runtime token is not configured.");
  }

  const response = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        payload?.message ||
        `Vercel request failed with status ${response.status}.`
    );
  }

  return payload;
}

async function executeVercel(action: string, params: Record<string, any>) {
  const teamId =
    String(params.team_id || "") ||
    process.env.KORBEN_VERCEL_TEAM_ID ||
    process.env.VERCEL_TEAM_ID ||
    "";
  const teamQuery = teamId ? `&teamId=${encodeURIComponent(teamId)}` : "";

  if (action === "project") {
    const project = String(params.project_id || params.project || "");
    return vercelRequest(
      `/v9/projects/${encodeURIComponent(project)}?x=1${teamQuery}`
    );
  }

  if (action === "deployments") {
    const project = String(params.project_id || params.project || "");
    return vercelRequest(
      `/v6/deployments?projectId=${encodeURIComponent(project)}${teamQuery}&limit=20`
    );
  }

  if (action === "deployment") {
    const id = String(params.deployment_id || "");
    return vercelRequest(
      `/v13/deployments/${encodeURIComponent(id)}?x=1${teamQuery}`
    );
  }

  throw new Error("Unsupported Vercel read action.");
}

async function executeVercelPreview(
  project: {
    name: string;
    github_repo: string | null;
    vercel_project_id: string | null;
  },
  params: Record<string, any>
) {
  if (!project.vercel_project_id) {
    throw new Error("The selected project does not have a Vercel project configured.");
  }

  if (!project.github_repo || !project.github_repo.includes("/")) {
    throw new Error("The selected project does not have a GitHub repository configured.");
  }

  const branch = String(params.branch || params.ref || "").trim();

  if (!branch) {
    throw new Error("A feature branch is required for a preview deployment.");
  }

  if (["main", "master"].includes(branch.toLowerCase())) {
    throw new Error("Preview deployments must use a feature branch, not main or master.");
  }

  const [org, repo] = project.github_repo.split("/");
  const teamId =
    process.env.KORBEN_VERCEL_TEAM_ID ||
    process.env.VERCEL_TEAM_ID ||
    "";
  const teamQuery = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";

  return vercelRequest(`/v13/deployments${teamQuery}`, {
    method: "POST",
    body: JSON.stringify({
      name: repo.toLowerCase(),
      project: project.vercel_project_id,
      gitSource: {
        type: "github",
        org,
        repo,
        ref: branch,
      },
      meta: {
        source: "korben",
        branch,
      },
    }),
  });
}

async function executeSupabaseRead(
  supabase: ReturnType<typeof serverSupabase>,
  action: string,
  params: Record<string, any>
) {
  if (action !== "select") {
    throw new Error("Unsupported Supabase read action.");
  }

  const table = String(params.table || "");
  const columns = String(params.columns || "*");
  const limit = Math.min(Math.max(Number(params.limit || 50), 1), 200);

  if (!/^[a-zA-Z0-9_]+$/.test(table)) {
    throw new Error("A valid table name is required.");
  }

  let query: any = supabase.from(table).select(columns).limit(limit);

  if (params.eq && typeof params.eq === "object") {
    for (const [column, value] of Object.entries(params.eq)) {
      if (!/^[a-zA-Z0-9_]+$/.test(column)) {
        throw new Error("Invalid filter column.");
      }
      query = query.eq(column, value);
    }
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function POST(request: Request) {
  const token = bearerToken(request);

  if (!token) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = (await request.json()) as ToolRequest;
  const tool = String(body.tool_system_key || "");
  const agentKey = String(body.agent_system_key || "");
  const projectId = String(body.project_id || "");
  const action = String(body.action || "");
  const params = body.params || {};

  if (!tool || !agentKey || !projectId || !action) {
    return NextResponse.json(
      { error: "tool_system_key, agent_system_key, project_id, and action are required." },
      { status: 400 }
    );
  }

  const supabase = serverSupabase(token);
  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id,name,github_repo,vercel_project_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Project is unavailable." }, { status: 403 });
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("id,system_key")
    .eq("system_key", agentKey)
    .maybeSingle();

  if (!agent) {
    return NextResponse.json({ error: "Agent is unavailable." }, { status: 403 });
  }

  const { data: permission } = await supabase
    .from("agent_tool_permissions")
    .select("can_execute,max_approval_level,tools!inner(system_key,risk_level,status)")
    .eq("agent_id", agent.id)
    .eq("tools.system_key", tool)
    .maybeSingle();

  const toolRecord: any = (permission as any)?.tools;

  if (
    !permission ||
    !permission.can_execute ||
    !toolRecord ||
    toolRecord.status !== "available"
  ) {
    return NextResponse.json(
      { error: "This agent is not permitted to use that tool." },
      { status: 403 }
    );
  }

  const riskLevel = toolRisk[tool] ?? Number(toolRecord.risk_level ?? 3);

  if (riskLevel > permission.max_approval_level) {
    return NextResponse.json(
      { error: "Agent permission does not cover this tool risk level." },
      { status: 403 }
    );
  }

  if (riskLevel >= 2) {
    if (!body.approval_id) {
      return NextResponse.json(
        { error: "Explicit approval is required for this action." },
        { status: 409 }
      );
    }

    const { data: approval } = await supabase
      .from("approvals")
      .select("id,status,risk_level,task_id")
      .eq("id", body.approval_id)
      .maybeSingle();

    if (
      !approval ||
      approval.status !== "approved" ||
      approval.risk_level < riskLevel ||
      (body.task_id && approval.task_id !== body.task_id)
    ) {
      return NextResponse.json(
        { error: "The supplied approval does not authorize this action." },
        { status: 403 }
      );
    }
  }

  const eventBase = {
    run_id: body.run_id || null,
    project_id: projectId,
    task_id: body.task_id || null,
    agent_id: agent.id,
    tool_system_key: tool,
  };

  await supabase.from("run_events").insert({
    ...eventBase,
    event_type: "tool_started",
    status: "running",
    message: `${agentKey} started ${tool}:${action}`,
    payload: { action },
  });

  try {
    let result: any;

    if (tool.startsWith("github.")) {
      if (!project.github_repo) {
        throw new Error("The selected project does not have a GitHub repository configured.");
      }

      const requestedRepo = params.repo ? String(params.repo) : project.github_repo;

      if (requestedRepo.toLowerCase() !== project.github_repo.toLowerCase()) {
        throw new Error("This agent cannot access a repository outside the selected project.");
      }

      result = await executeGitHub(tool, action, {
        ...params,
        repo: project.github_repo,
      });
    } else if (tool === "vercel.read") {
      if (!project.vercel_project_id) {
        throw new Error("The selected project does not have a Vercel project configured.");
      }

      const requestedProject = String(
        params.project_id || params.project || project.vercel_project_id
      );

      if (requestedProject !== project.vercel_project_id) {
        throw new Error("This agent cannot access a Vercel project outside the selected project.");
      }

      result = await executeVercel(action, {
        ...params,
        project_id: project.vercel_project_id,
      });
    } else if (tool === "vercel.preview") {
      if (action !== "deploy") {
        throw new Error("Unsupported Vercel preview action.");
      }

      result = await executeVercelPreview(project, params);
    } else if (tool === "supabase.read") {
      result = await executeSupabaseRead(supabase, action, params);
    } else {
      throw new Error("This tool adapter is registered but not implemented yet.");
    }

    await supabase.from("run_events").insert({
      ...eventBase,
      event_type: "tool_completed",
      status: "complete",
      message: `${tool}:${action} completed`,
      payload: { action },
    });

    return NextResponse.json({ ok: true, tool, action, result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Tool execution failed.";

    await supabase.from("run_events").insert({
      ...eventBase,
      event_type: "tool_failed",
      status: "error",
      message,
      payload: { action },
    });

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
