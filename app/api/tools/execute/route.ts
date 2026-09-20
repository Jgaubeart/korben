import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  approvalAuthorizes,
  approvalBinding,
  classifyApproval,
  type ProtectedAction,
  type VerifiedEffects,
} from "../../../../lib/approval-policy";
import { runBrowserInspection } from "../../../../lib/browser-inspection-runner";

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


function normalizeRepoTarget(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

function repoMatchesProject(requested: string, configured: string) {
  const requestedNormalized = normalizeRepoTarget(requested);
  const configuredNormalized = normalizeRepoTarget(configured);
  const configuredName = configuredNormalized.split("/").pop() || "";

  return (
    requestedNormalized === configuredNormalized ||
    requestedNormalized === configuredName
  );
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function receiptEvidence(tool: string, action: string, result: any) {
  if (!result || typeof result !== "object") {
    return { action };
  }

  const safe: Record<string, any> = { action };

  for (const key of [
    "id",
    "sha",
    "ref",
    "url",
    "html_url",
    "number",
    "state",
    "status",
    "name",
    "branch",
    "target",
    "readyState",
  ]) {
    if (key in result && ["string", "number", "boolean"].includes(typeof result[key])) {
      safe[key] = result[key];
    }
  }

  if (result.object && typeof result.object === "object" && result.object.sha) {
    safe.object_sha = result.object.sha;
  }

  if (result.content && typeof result.content === "object") {
    if (result.content.sha) safe.content_sha = result.content.sha;
    if (result.content.path) safe.path = result.content.path;
  }

  if (Array.isArray(result)) {
    safe.row_count = result.length;
  }

  safe.tool = tool;
  return safe;
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

    if (action === "commit") {
      const ref = String(params.ref || params.sha || "").trim();

      if (!ref) {
        throw new Error("ref or sha is required.");
      }

      return githubRequest(
        `/repos/${owner}/${name}/commits/${encodeURIComponent(ref)}`
      );
    }

    if (action === "compare") {
      const base = String(params.base || "").trim();
      const head = String(params.head || "").trim();

      if (!base || !head) {
        throw new Error("base and head are required.");
      }

      return githubRequest(
        `/repos/${owner}/${name}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`
      );
    }

    if (action === "workflow_runs") {
      const headSha = String(params.head_sha || params.sha || "").trim();

      if (!headSha) {
        throw new Error("head_sha is required.");
      }

      return githubRequest(
        `/repos/${owner}/${name}/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=20`
      );
    }

    if (action === "workflow_run") {
      const runId = Number(params.run_id || params.id);

      if (!Number.isFinite(runId) || runId <= 0) {
        throw new Error("run_id is required.");
      }

      return githubRequest(
        `/repos/${owner}/${name}/actions/runs/${runId}`
      );
    }

    if (action === "workflow_jobs") {
      const runId = Number(params.run_id || params.id);

      if (!Number.isFinite(runId) || runId <= 0) {
        throw new Error("run_id is required.");
      }

      return githubRequest(
        `/repos/${owner}/${name}/actions/runs/${runId}/jobs?per_page=100`
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

    if (action === "sync_branch") {
      const branch = String(params.branch || "").trim();
      const source = String(params.source || "main").trim();

      if (!branch) {
        throw new Error("branch is required.");
      }

      if (["main", "master"].includes(branch.toLowerCase())) {
        throw new Error("sync_branch cannot target main or master.");
      }

      if (!["main", "master"].includes(source.toLowerCase())) {
        throw new Error("sync_branch only permits syncing from main/master into a feature branch.");
      }

      return githubRequest(`/repos/${owner}/${name}/merges`, {
        method: "POST",
        body: JSON.stringify({
          base: branch,
          head: source,
          commit_message: String(
            params.message || `Sync ${branch} with ${source} via Korben`
          ),
        }),
      });
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

async function browserAllowedOrigins(
  project: { vercel_project_id: string | null },
  rawUrl: string
) {
  if (!project.vercel_project_id) {
    throw new Error("The selected project does not have a Vercel project configured.");
  }

  const target = new URL(rawUrl);
  const teamId =
    process.env.KORBEN_VERCEL_TEAM_ID ||
    process.env.VERCEL_TEAM_ID ||
    "";
  const teamSuffix = teamId ? `&teamId=${encodeURIComponent(teamId)}` : "";
  const origins = new Set<string>();

  const deployments = await vercelRequest(
    `/v6/deployments?projectId=${encodeURIComponent(project.vercel_project_id)}${teamSuffix}&limit=100`
  );

  for (const deployment of deployments?.deployments || []) {
    if (deployment?.url) {
      origins.add(new URL(`https://${deployment.url}`).origin);
    }

    for (const alias of deployment?.alias || []) {
      if (typeof alias === "string" && alias) {
        origins.add(new URL(`https://${alias}`).origin);
      }
    }
  }

  try {
    const domainQuery = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
    const domains = await vercelRequest(
      `/v9/projects/${encodeURIComponent(project.vercel_project_id)}/domains${domainQuery}`
    );

    for (const item of domains?.domains || []) {
      if (item?.name) {
        origins.add(new URL(`https://${item.name}`).origin);
      }
    }
  } catch {
    // Deployment origins are sufficient for preview inspection.
  }

  if (!origins.has(target.origin)) {
    throw new Error(
      "Browser inspection can only open a deployment or domain owned by the selected Vercel project."
    );
  }

  return [...origins];
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

async function executeSupabaseWrite(
  supabase: ReturnType<typeof serverSupabase>,
  action: string,
  params: Record<string, any>
) {
  const table = String(params.table || "");

  if (!/^[a-zA-Z0-9_]+$/.test(table)) {
    throw new Error("A valid table name is required.");
  }

  const protectedTables = new Set([
    "organizations",
    "organization_memberships",
    "agents",
    "tools",
    "agent_tool_permissions",
    "approvals",
  ]);

  if (protectedTables.has(table)) {
    throw new Error("This table is protected from L1 data writes.");
  }

  if (action === "insert") {
    const rows = Array.isArray(params.rows)
      ? params.rows
      : params.row
        ? [params.row]
        : [];

    if (!rows.length || rows.length > 20) {
      throw new Error("Insert requires between 1 and 20 rows.");
    }

    const { data, error } = await supabase
      .from(table)
      .insert(rows)
      .select();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  if (action === "update") {
    const id = String(params.id || "").trim();
    const values = params.values;

    if (!id || !values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error("Update requires a specific row id and values object.");
    }

    if ("id" in values) {
      throw new Error("Primary key changes are not permitted.");
    }

    const { data, error } = await supabase
      .from(table)
      .update(values)
      .eq("id", id)
      .select();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  throw new Error("Supabase L1 writes support only insert and update.");
}

async function verifyActionEffects(
  project: { github_repo: string | null; vercel_project_id: string | null },
  protectedAction: ProtectedAction
): Promise<VerifiedEffects> {
  const effects: VerifiedEffects = {
    repository: project.github_repo || undefined,
    vercelProjectId: project.vercel_project_id || undefined,
  };

  if (protectedAction.tool === "github.merge" && protectedAction.action === "merge") {
    if (!project.github_repo || !project.github_repo.includes("/")) {
      throw new Error("The selected project does not have a GitHub repository configured.");
    }

    const number = Number(protectedAction.params.number);
    if (!Number.isFinite(number) || number <= 0) {
      throw new Error("A pull request number is required.");
    }

    const [owner, name] = project.github_repo.split("/");
    const pr = await githubRequest(`/repos/${owner}/${name}/pulls/${number}`);
    const baseBranch = String(pr?.base?.ref || "");
    const headSha = String(pr?.head?.sha || "");

    if (!baseBranch || !headSha) {
      throw new Error("Could not verify pull request target state.");
    }

    effects.baseBranch = baseBranch;
    effects.targetBranch = baseBranch;
    effects.pullRequestNumber = number;
    effects.pullRequestHeadSha = headSha;
    effects.productionDeploymentTriggered = Boolean(
      project.vercel_project_id &&
      ["main", "master"].includes(baseBranch.toLowerCase())
    );
  }

  if (protectedAction.tool === "github.write") {
    const branch = String(protectedAction.params.branch || "").trim();
    if (branch) effects.targetBranch = branch;
  }

  if (protectedAction.tool === "github.pr" && protectedAction.action === "create") {
    effects.baseBranch = String(protectedAction.params.base || "main");
    effects.targetBranch = effects.baseBranch;
  }

  if (protectedAction.tool === "vercel.preview") {
    effects.targetBranch =
      String(protectedAction.params.branch || protectedAction.params.ref || "").trim() ||
      undefined;
  }

  if (protectedAction.tool === "vercel.production") {
    effects.productionDeploymentTriggered = true;
  }

  if (protectedAction.tool === "supabase.migration") {
    effects.databaseMigration = true;
  }

  return effects;
}

async function executeKnowledgeSearch(
  supabase: ReturnType<typeof serverSupabase>,
  project: {
    id: string;
    business_id: string;
    name: string;
  },
  params: Record<string, any>
) {
  const queryText = String(params.query || params.q || "").trim();
  const limit = Math.min(Math.max(Number(params.limit || 8), 1), 20);

  if (!queryText) {
    throw new Error("A knowledge search query is required.");
  }

  const gbrainUrl = process.env.KORBEN_GBRAIN_URL;

  if (gbrainUrl) {
    try {
      const response = await fetch(
        `${gbrainUrl.replace(/\/$/, "")}/search`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.KORBEN_GBRAIN_TOKEN
              ? { Authorization: `Bearer ${process.env.KORBEN_GBRAIN_TOKEN}` }
              : {}),
          },
          body: JSON.stringify({
            query: queryText,
            project: project.name,
            limit,
          }),
        }
      );

      if (response.ok) {
        const result = await response.json();
        return {
          provider: "gbrain",
          results: result?.results || result,
        };
      }
    } catch {
      // Fall back to governed local knowledge below.
    }
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("organization_id")
    .eq("id", project.business_id)
    .single();

  if (businessError || !business) {
    throw new Error("Could not resolve the project knowledge scope.");
  }

  let knowledgeQuery: any = supabase
    .from("knowledge_entries")
    .select("id,entry_type,title,content,source_uri,status,tags,metadata,project_id,updated_at")
    .eq("organization_id", business.organization_id)
    .eq("status", "active")
    .limit(250);

  if (params.entry_type) {
    knowledgeQuery = knowledgeQuery.eq("entry_type", String(params.entry_type));
  }

  const { data, error } = await knowledgeQuery;

  if (error) {
    throw new Error(error.message);
  }

  const terms = queryText
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/[^a-z0-9_-]/g, ""))
    .filter((term) => term.length >= 2);

  const ranked = (data || [])
    .filter((entry: any) => !entry.project_id || entry.project_id === project.id)
    .map((entry: any) => {
      const title = String(entry.title || "").toLowerCase();
      const content = String(entry.content || "").toLowerCase();
      const tags = Array.isArray(entry.tags)
        ? entry.tags.join(" ").toLowerCase()
        : "";

      let score = 0;

      for (const term of terms) {
        if (title.includes(term)) score += 5;
        if (tags.includes(term)) score += 3;
        if (content.includes(term)) score += 1;
      }

      return { ...entry, score };
    })
    .filter((entry: any) => entry.score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, limit)
    .map((entry: any) => ({
      id: entry.id,
      entry_type: entry.entry_type,
      title: entry.title,
      excerpt:
        String(entry.content || "").length > 1200
          ? `${String(entry.content).slice(0, 1200)}…`
          : entry.content,
      source_uri: entry.source_uri,
      tags: entry.tags,
      score: entry.score,
    }));

  return {
    provider: "korben_local",
    results: ranked,
  };
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
    .select("id,name,business_id,github_repo,vercel_project_id")
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

  const effectiveParams: Record<string, any> = { ...params };
  if (tool.startsWith("github.") && project.github_repo) effectiveParams.repo = project.github_repo;
  if (tool.startsWith("vercel.") && project.vercel_project_id) effectiveParams.project_id = project.vercel_project_id;

  const protectedAction: ProtectedAction = { tool, action, params: effectiveParams };
  const verifiedEffects = await verifyActionEffects(project, protectedAction);
  const requiredLevel = classifyApproval(protectedAction, verifiedEffects);
  const requiredBinding = approvalBinding(protectedAction, verifiedEffects);

  if (requiredLevel > permission.max_approval_level) {
    return NextResponse.json(
      { error: "Agent permission does not cover the verified approval level.", required_level: requiredLevel },
      { status: 403 }
    );
  }

  if (requiredLevel >= 2) {
    if (!body.task_id) {
      return NextResponse.json({ error: "Protected actions require a task-bound approval." }, { status: 403 });
    }

    let approval: any = null;
    if (body.approval_id) {
      const { data } = await supabase
        .from("approvals")
        .select("id,status,risk_level,task_id,request_payload")
        .eq("id", body.approval_id)
        .maybeSingle();
      approval = data;
    }

    const storedBinding = String(approval?.request_payload?.approval_binding || "");
    const authorized =
      approval?.task_id === body.task_id &&
      approvalAuthorizes(
        {
          level: Number(approval?.risk_level || 0) as 0 | 1 | 2 | 3,
          binding: storedBinding,
          status: String(approval?.status || ""),
        },
        protectedAction,
        verifiedEffects
      );

    if (!authorized) {
      const exactPayload = {
        approval_binding: requiredBinding,
        action: protectedAction,
        verified_effects: verifiedEffects,
      };

      const { data: pendingApproval } = await supabase
        .from("approvals")
        .select("id")
        .eq("task_id", body.task_id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pendingApproval?.id) {
        await supabase
          .from("approvals")
          .update({
            action_type: `${tool}:${action}`,
            risk_level: requiredLevel,
            request_payload: exactPayload,
          })
          .eq("id", pendingApproval.id);
      } else {
        await supabase.from("approvals").insert({
          task_id: body.task_id,
          action_type: `${tool}:${action}`,
          risk_level: requiredLevel,
          status: "pending",
          request_payload: exactPayload,
        });
      }

      return NextResponse.json(
        {
          error: "Exact approval is required for this action.",
          approval_required: { required_level: requiredLevel, ...exactPayload },
        },
        { status: 409 }
      );
    }
  }

  let receiptObjectiveId: string | null = null;

  if (body.task_id) {
    const { data: taskScope } = await supabase
      .from("tasks")
      .select("objective_id")
      .eq("id", body.task_id)
      .maybeSingle();

    receiptObjectiveId = taskScope?.objective_id || null;
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

      if (!repoMatchesProject(requestedRepo, project.github_repo)) {
        throw new Error("This agent cannot access a repository outside the selected project.");
      }

      result = await executeGitHub(tool, action, effectiveParams);
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

      result = await executeVercel(action, effectiveParams);
    } else if (tool === "vercel.preview") {
      if (action !== "deploy") {
        throw new Error("Unsupported Vercel preview action.");
      }

      result = await executeVercelPreview(project, effectiveParams);
    } else if (tool === "supabase.read") {
      result = await executeSupabaseRead(supabase, action, params);
    } else if (tool === "supabase.write") {
      result = await executeSupabaseWrite(supabase, action, params);
    } else if (tool === "knowledge.search") {
      if (action !== "search") {
        throw new Error("Unsupported knowledge action.");
      }
      result = await executeKnowledgeSearch(supabase, project, params);
    } else if (tool === "browser.inspect") {
      if (action !== "inspect") {
        throw new Error("Unsupported browser inspection action.");
      }

      if (agent.system_key !== "qa_engineer") {
        throw new Error("Browser inspection is restricted to Sentinel.");
      }

      const targetUrl = String(params.url || "").trim();
      if (!targetUrl) {
        throw new Error("A browser inspection URL is required.");
      }

      const allowedOrigins = await browserAllowedOrigins(project, targetUrl);
      result = await runBrowserInspection(params, allowedOrigins);
    } else {
      throw new Error("This tool adapter is registered but not implemented yet.");
    }

    await Promise.all([
      supabase.from("run_events").insert({
        ...eventBase,
        event_type: "tool_completed",
        status: "complete",
        message: `${tool}:${action} completed`,
        payload: { action },
      }),
      supabase.from("action_receipts").insert({
        project_id: projectId,
        objective_id: receiptObjectiveId,
        task_id: body.task_id || null,
        run_id: body.run_id || null,
        agent_id: agent.id,
        tool_system_key: tool,
        action,
        status: "complete",
        summary: `${agentKey} completed ${tool}:${action}`,
        evidence: receiptEvidence(tool, action, result),
      }),
    ]);

    return NextResponse.json({ ok: true, tool, action, result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Tool execution failed.";

    await Promise.all([
      supabase.from("run_events").insert({
        ...eventBase,
        event_type: "tool_failed",
        status: "error",
        message,
        payload: { action },
      }),
      supabase.from("action_receipts").insert({
        project_id: projectId,
        objective_id: receiptObjectiveId,
        task_id: body.task_id || null,
        run_id: body.run_id || null,
        agent_id: agent.id,
        tool_system_key: tool,
        action,
        status: "failed",
        summary: message,
        evidence: { tool, action },
      }),
    ]);

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
