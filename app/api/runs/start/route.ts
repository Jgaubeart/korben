import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { POST as executeToolRoute } from "../../tools/execute/route";

type InputItem = Record<string, any>;

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
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function responseText(payload: any) {
  return (
    payload?.output_text ||
    payload?.output
      ?.flatMap((item: any) => item?.content || [])
      ?.find((item: any) => item?.type === "output_text")
      ?.text ||
    ""
  );
}

function safeJson(value: any, max = 30000) {
  const text = JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const READ_ONLY_TOOLS = new Set([
  "github.read",
  "vercel.read",
  "supabase.read",
  "knowledge.search",
  "browser.inspect",
]);

async function executeToolRequestWithRetry(
  url: string,
  token: string,
  body: Record<string, any>,
  retryable: boolean
) {
  const maxAttempts = retryable ? 3 : 1;
  let lastStatus = 500;
  let lastResult: any = { error: "Tool request failed." };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const toolRequest = new Request(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const response = await executeToolRoute(toolRequest);

      const raw = await response.text();
      let result: any;

      try {
        result = raw ? JSON.parse(raw) : {};
      } catch {
        result = {
          error: raw
            ? `Tool returned a non-JSON response: ${raw.slice(0, 1200)}`
            : "Tool returned an empty response.",
        };
      }

      lastStatus = response.status;
      lastResult = result;

      if (response.ok || response.status === 409) {
        return {
          response,
          result,
          attempts: attempt,
        };
      }

      const shouldRetry =
        retryable &&
        (response.status === 408 ||
          response.status === 429 ||
          response.status >= 500);

      if (!shouldRetry || attempt === maxAttempts) {
        return {
          response,
          result,
          attempts: attempt,
        };
      }
    } catch (error) {
      lastStatus = 503;
      lastResult = {
        error:
          error instanceof Error
            ? error.message
            : "Tool request could not be completed.",
      };

      if (!retryable || attempt === maxAttempts) {
        const response = new Response(JSON.stringify(lastResult), {
          status: lastStatus,
          headers: { "Content-Type": "application/json" },
        });
        return { response, result: lastResult, attempts: attempt };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
  }

  const response = new Response(JSON.stringify(lastResult), {
    status: lastStatus,
    headers: { "Content-Type": "application/json" },
  });
  return { response, result: lastResult, attempts: maxAttempts };
}

const TOOL_ACTION_GUIDE: Record<string, string> = {
  "github.read":
    "Valid actions: repo, file, branch, branches, pull_request, pull_requests, commit, compare, workflow_runs, workflow_run, workflow_jobs. file accepts {path,ref?,start_line?,end_line?} and returns decoded UTF-8 content in bounded line windows. Use branches and pull_requests when an identifier was not supplied. Use commit to inspect an exact commit/ref. Use compare with {base, head} to verify ancestry, ahead/behind counts, and changed files. Use workflow_runs with {head_sha} to discover Actions runs tied to the exact commit under review; then use workflow_run with {run_id} to verify SHA/status/conclusion and workflow_jobs with {run_id} to verify job and step conclusions. Never use create/update/merge here.",
  "github.write":
    "Valid actions: create_branch, replace_text, update_file, sync_branch. Prefer replace_text for focused edits to existing files: provide {path,branch,search,replacement,expected_count?,message?}. update_file is for new files or deliberate full-file rewrites and is guarded against stale SHAs and suspicious large deletions. sync_branch may only merge main/master into an existing feature branch; it must never target main/master or force-reset history.",
  "github.pr":
    "Valid action: create only. Use this only to open a pull request; do not use it to list/read PRs.",
  "github.merge":
    "Valid action: merge only. Runtime verification may escalate a merge to L3 when the verified target triggers production.",
  "vercel.read":
    "Valid actions: project, deployments, deployment.",
  "vercel.preview":
    "Valid action: deploy only. Branch/ref must not be main/master.",
  "vercel.production":
    "Production actions are L3 and require explicit owner approval.",
  "supabase.read":
    "Valid action: select.",
  "supabase.write":
    "Valid actions: insert, update.",
  "knowledge.search":
    "Valid action: search.",
};

const riskByTool: Record<string, number> = {
  "github.read": 0,
  "github.write": 1,
  "github.pr": 1,
  "github.merge": 2,
  "vercel.read": 0,
  "vercel.preview": 1,
  "vercel.production": 3,
  "supabase.read": 0,
  "supabase.write": 1,
  "supabase.sql": 1,
  "supabase.migration": 2,
  "openai.orchestrate": 0,
  "knowledge.search": 0,
};

export async function POST(request: Request) {
  const token = bearerToken(request);

  if (!token) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 503 }
    );
  }

  const body = await request.json();
  const taskId = String(body?.task_id || "");

  if (!taskId) {
    return NextResponse.json({ error: "task_id is required." }, { status: 400 });
  }

  const supabase = serverSupabase(token);
  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select(
      "id,title,description,status,sequence,acceptance_criteria,assigned_agent_id,objective_id,stage,parallel_group,progress_message,last_heartbeat_at,started_at"
    )
    .eq("id", taskId)
    .maybeSingle();

  if (taskError || !task) {
    return NextResponse.json({ error: "Task is unavailable." }, { status: 404 });
  }

  if (!task.assigned_agent_id) {
    return NextResponse.json(
      { error: "Task does not have an assigned agent." },
      { status: 409 }
    );
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("id,name,role,system_key,status")
    .eq("id", task.assigned_agent_id)
    .maybeSingle();

  if (!agent) {
    return NextResponse.json({ error: "Assigned agent is unavailable." }, { status: 404 });
  }

  const { data: objective } = await supabase
    .from("objectives")
    .select("id,title,description,project_id")
    .eq("id", task.objective_id)
    .maybeSingle();

  if (!objective) {
    return NextResponse.json({ error: "Objective is unavailable." }, { status: 404 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id,name,slug,github_repo,vercel_project_id,status")
    .eq("id", objective.project_id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Project is unavailable." }, { status: 404 });
  }

  const { data: siblingTasks } = await supabase
    .from("tasks")
    .select("id,title,sequence,status")
    .eq("objective_id", objective.id)
    .lt("sequence", task.sequence)
    .order("sequence");

  const priorTaskIds = (siblingTasks || []).map((item) => item.id);
  let priorTaskContext: Array<{
    sequence: number;
    title: string;
    status: string;
    summary: string;
  }> = [];

  if (priorTaskIds.length) {
    const { data: priorRuns } = await supabase
      .from("agent_runs")
      .select("task_id,status,output,completed_at")
      .in("task_id", priorTaskIds)
      .order("completed_at", { ascending: false });

    priorTaskContext = (siblingTasks || []).map((item) => {
      const matchingRun = (priorRuns || []).find(
        (run: any) => run.task_id === item.id && run.status === "complete"
      );

      const summary =
        matchingRun?.output &&
        typeof matchingRun.output === "object" &&
        "summary" in matchingRun.output
          ? String((matchingRun.output as any).summary || "")
          : "";

      return {
        sequence: item.sequence,
        title: item.title,
        status: item.status,
        summary,
      };
    });
  }

  let recentProjectContext: Array<{
    objective: string;
    task: string;
    status: string;
    summary: string;
  }> = [];

  const { data: recentObjectives } = await supabase
    .from("objectives")
    .select("id,title,created_at")
    .eq("project_id", project.id)
    .neq("id", objective.id)
    .order("created_at", { ascending: false })
    .limit(4);

  const recentObjectiveIds = (recentObjectives || []).map((item: any) => item.id);

  if (recentObjectiveIds.length) {
    const { data: recentTasks } = await supabase
      .from("tasks")
      .select("id,objective_id,title,status,sequence")
      .in("objective_id", recentObjectiveIds)
      .order("sequence", { ascending: true });

    const recentTaskIds = (recentTasks || []).map((item: any) => item.id);

    if (recentTaskIds.length) {
      const { data: recentRuns } = await supabase
        .from("agent_runs")
        .select("task_id,status,output,completed_at")
        .in("task_id", recentTaskIds)
        .order("completed_at", { ascending: false });

      recentProjectContext = (recentTasks || [])
        .map((item: any) => {
          const matchingRun = (recentRuns || []).find(
            (run: any) =>
              run.task_id === item.id &&
              run.output &&
              typeof run.output === "object" &&
              "summary" in run.output
          );

          if (!matchingRun) return null;

          const parentObjective = (recentObjectives || []).find(
            (candidate: any) => candidate.id === item.objective_id
          );

          return {
            objective: String(parentObjective?.title || ""),
            task: String(item.title || ""),
            status: String(matchingRun.status || item.status || ""),
            summary: String((matchingRun.output as any).summary || ""),
          };
        })
        .filter(Boolean)
        .slice(0, 8) as Array<{
          objective: string;
          task: string;
          status: string;
          summary: string;
        }>;
    }
  }

  const { data: permissionRows } = await supabase
    .from("agent_tool_permissions")
    .select(
      "max_approval_level,can_execute,tools!inner(system_key,name,description,status,risk_level)"
    )
    .eq("agent_id", agent.id)
    .eq("can_execute", true);

  const permissions = (permissionRows || [])
    .map((row: any) => ({
      max_approval_level: row.max_approval_level,
      tool: row.tools,
    }))
    .filter((row: any) => row.tool?.status === "available");

  const allowedToolKeys = permissions.map((row: any) => String(row.tool.system_key));

  const { data: run, error: runError } = await supabase
    .from("agent_runs")
    .insert({
      task_id: task.id,
      agent_id: agent.id,
      status: "running",
      model:
        process.env.OPENAI_AGENT_MODEL ||
        process.env.OPENAI_ORCHESTRATOR_MODEL ||
        "gpt-5.6-sol",
      input: {
        objective: objective.title,
        task: task.title,
        project: project.name,
        allowed_tools: allowedToolKeys,
      },
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: "Could not create agent run." }, { status: 500 });
  }

  const runId = run.id;

  await Promise.all([
    supabase
      .from("tasks")
      .update({
        status: "in_progress",
        started_at: task.started_at || new Date().toISOString(),
        progress_message: `Working · ${task.stage || "Operate"}`,
        last_heartbeat_at: new Date().toISOString(),
      })
      .eq("id", task.id),
    supabase.from("agents").update({ status: "working" }).eq("id", agent.id),
    supabase.from("run_events").insert({
      run_id: runId,
      project_id: project.id,
      task_id: task.id,
      agent_id: agent.id,
      event_type: "agent_started",
      status: "running",
      message: `${agent.name} started ${task.title}`,
      payload: {
        allowed_tools: allowedToolKeys,
        stage: task.stage || "Operate",
        parallel_group: task.parallel_group || 0,
      },
    }),
  ]);

  let knowledgeContext: any = null;

  if (allowedToolKeys.includes("knowledge.search")) {
    try {
      const knowledgeRequest = new Request(
        `${new URL(request.url).origin}/api/tools/execute`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tool_system_key: "knowledge.search",
            agent_system_key: agent.system_key,
            project_id: project.id,
            task_id: task.id,
            run_id: runId,
            action: "search",
            params: {
              query: [objective.title, task.title, task.description]
                .filter(Boolean)
                .join(" "),
              limit: 8,
            },
          }),
        }
      );
      const knowledgeResponse = await executeToolRoute(knowledgeRequest);

      if (knowledgeResponse.ok) {
        const payload = await knowledgeResponse.json();
        knowledgeContext = payload?.result || null;
      }
    } catch {
      knowledgeContext = null;
    }
  }

  const toolDefinition = allowedToolKeys.length
    ? [
        {
          type: "function",
          name: "execute_tool",
          description:
            "Execute one of your explicitly allowed Korben runtime tools. Use only when necessary to complete the assigned task.",
          strict: true,
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              tool_system_key: {
                type: "string",
                enum: allowedToolKeys,
              },
              action: {
                type: "string",
                description:
                  "Provider action. Examples: repo, file, branch, pull_request, commit, compare, workflow_runs, workflow_run, workflow_jobs, create_branch, update_file, sync_branch, create, merge, project, deployments, deployment, deploy, select, insert, update, search, inspect.",
              },
              params_json: {
                type: "string",
                description:
                  "A JSON object serialized as a string containing parameters for the tool action.",
              },
            },
            required: ["tool_system_key", "action", "params_json"],
          },
        },
      ]
    : [];

  const instruction = [
    `You are ${agent.name}, Korben's ${agent.role}.`,
    "Complete only the assigned task. Do not broaden scope.",
    "Use tools only when they are necessary and only through execute_tool.",
    "Use only the exact actions listed in the tool action contract. Never invent provider actions.",
    "For read-only verification, use read tools only. Do not probe a write tool with a read/list action.",
    allowedToolKeys.includes("browser.inspect")
      ? "For browser.inspect use action=inspect. params_json must include a configured Vercel deployment/domain URL. Optional fields: viewport {width,height}, text_scale_percent (100/125/150/175/200), screenshot boolean, and up to 16 safe steps of type click/fill/wait_for. Use browser.inspect to verify responsive layout, overflow, console errors, and viewport-specific acceptance criteria."
      : "",
    "Never attempt to bypass an approval boundary.",
    "GitHub writes must use a feature branch, never main or master.",
    "For existing files, prefer github.write:replace_text over full-file update_file. This prevents truncated or partial agent output from corrupting large files.",
    "If a required tool is unavailable or an approval is required, clearly state the blocker and stop.",
    "Recoverable exploratory misses such as a file path returning Not Found do not by themselves mean the task failed; continue if you can still satisfy the acceptance criteria.",
    "Transient read failures are not blockers. The runtime automatically retries read-only tool calls on 408, 429, 5xx, empty, or unreadable responses. If a read still fails, try another valid read path such as repo, branches, pull_requests, commit, compare, or a smaller file line window before declaring BLOCKED.",
    "Your final response MUST begin with exactly one status line: TASK_STATUS: COMPLETE, TASK_STATUS: BLOCKED, or TASK_STATUS: FAILED.",
    "Use COMPLETE only when the acceptance criteria are satisfied. Use BLOCKED when required access, data, approval, or a required verification capability is unavailable. Use FAILED only when a non-recoverable execution error prevents completion.",
    "After the status line, return a concise completion summary including what changed and any remaining risk.",
    "",
    `Project: ${project.name}`,
    `GitHub repo: ${project.github_repo || "not configured"}`,
    `Vercel project: ${project.vercel_project_id || "not configured"}`,
    `Objective: ${objective.title}`,
    objective.description ? `Objective context: ${objective.description}` : "",
    `Task: ${task.title}`,
    `Mission stage: ${task.stage || "Operate"}`,
    task.description ? `Task details: ${task.description}` : "",
    `Acceptance criteria: ${safeJson(task.acceptance_criteria || [])}`,
    `Allowed tools: ${allowedToolKeys.join(", ") || "none"}`,
    allowedToolKeys.length
      ? `Exact tool action contract:\n${allowedToolKeys
          .map((key) => `- ${key}: ${TOOL_ACTION_GUIDE[key] || "Use only documented actions."}`)
          .join("\n")}`
      : "No tools are available.",
    priorTaskContext.length
      ? `Outputs from earlier tasks in this objective. Treat these as authoritative handoff context and reuse exact identifiers such as branch names, commit SHAs, PR numbers, file paths, and deployment URLs:\n${safeJson(
          priorTaskContext,
          16000
        )}`
      : "No earlier task outputs are available for this objective.",
    recentProjectContext.length
      ? `Recent outputs from related work in this same project. Use these to continue existing missions across objective boundaries. Reuse exact durable identifiers such as branch names, commit SHAs, PR numbers, file paths, and deployment URLs when clearly relevant, but re-verify mutable state before acting:\n${safeJson(
          recentProjectContext,
          24000
        )}`
      : "No recent cross-objective project context is available.",
    knowledgeContext
      ? `Shared knowledge retrieved before execution: ${safeJson(knowledgeContext, 16000)}`
      : "Shared knowledge search returned no additional context.",
  ]
    .filter(Boolean)
    .join("\n");

  let input: InputItem[] = [
    {
      role: "user",
      content: instruction,
    },
  ];

  let finalText = "";
  let approvalBlocked = false;
  let executionFailed = false;
  let hadRecoverableToolFailure = false;
  const maxTurns = 12;
  const model =
    process.env.OPENAI_AGENT_MODEL ||
    process.env.OPENAI_ORCHESTRATOR_MODEL ||
    "gpt-5.6-sol";

  try {
    for (let turn = 0; turn < maxTurns; turn += 1) {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: "none" },
          instructions:
            "You are a specialist agent operating inside Korben OS. Follow the user-supplied task context and the tool/approval rules exactly.",
          input,
          tools: toolDefinition,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error?.message ||
            `OpenAI agent turn failed with status ${response.status}.`
        );
      }

      const outputItems = Array.isArray(payload.output) ? payload.output : [];
      const calls = outputItems.filter(
        (item: any) => item?.type === "function_call" && item?.name === "execute_tool"
      );

      if (!calls.length) {
        finalText = responseText(payload) || "Task completed.";
        break;
      }

      input = [...input, ...outputItems];

      for (const call of calls) {
        let args: any;

        try {
          args = JSON.parse(call.arguments || "{}");
        } catch {
          args = {};
        }

        const toolKey = String(args.tool_system_key || "");
        const action = String(args.action || "");
        let params: Record<string, any> = {};

        try {
          params = JSON.parse(String(args.params_json || "{}"));
        } catch {
          params = {};
        }

        if (!allowedToolKeys.includes(toolKey)) {
          executionFailed = true;
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: safeJson({
              ok: false,
              error: "Agent requested a tool it is not permitted to use.",
            }),
          });
          continue;
        }

        const { data: latestApproved } = await supabase
          .from("approvals")
          .select("id,status,risk_level,request_payload,decided_at")
          .eq("task_id", task.id)
          .eq("status", "approved")
          .order("decided_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const approvalId = latestApproved?.id || null;

        await Promise.all([
          supabase
            .from("tasks")
            .update({
              progress_message: `${task.stage || "Operate"} · ${toolKey}:${action}`,
              last_heartbeat_at: new Date().toISOString(),
            })
            .eq("id", task.id),
          supabase.from("run_events").insert({
            run_id: runId,
            project_id: project.id,
            task_id: task.id,
            agent_id: agent.id,
            event_type: "stage_progress",
            status: "running",
            message: `${task.stage || "Operate"} · ${toolKey}:${action}`,
            payload: {
              stage: task.stage || "Operate",
              tool: toolKey,
              action,
            },
          }),
        ]);

        const {
          response: toolResponse,
          result,
          attempts: toolAttempts,
        } = await executeToolRequestWithRetry(
          `${new URL(request.url).origin}/api/tools/execute`,
          token,
          {
            tool_system_key: toolKey,
            agent_system_key: agent.system_key,
            project_id: project.id,
            task_id: task.id,
            run_id: runId,
            approval_id: approvalId,
            action,
            params,
          },
          READ_ONLY_TOOLS.has(toolKey)
        );

        if (!toolResponse.ok) {
          if (toolResponse.status === 409) {
            approvalBlocked = true;
          } else {
            hadRecoverableToolFailure = true;
          }
        }

        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: safeJson({
            ok: toolResponse.ok,
            status: toolResponse.status,
            result,
            attempts: toolAttempts,
            retry_exhausted:
              !toolResponse.ok &&
              READ_ONLY_TOOLS.has(toolKey) &&
              toolAttempts >= 3,
          }),
        });
      }
    }

    if (!finalText && !approvalBlocked) {
      try {
        const finalResponse = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            reasoning: { effort: "none" },
            instructions:
              "You are a specialist agent operating inside Korben OS. The tool-execution phase has ended. Do not request any more tools. Review the complete transcript and decide whether the assigned task acceptance criteria were satisfied. Your response MUST begin with exactly one line: TASK_STATUS: COMPLETE, TASK_STATUS: BLOCKED, or TASK_STATUS: FAILED. Then summarize the work performed, exact artifacts created or changed, any recoverable tool misses, and remaining risk.",
            input: [
              ...input,
              {
                role: "user",
                content:
                  "Tool execution is finished. Produce the final task status and completion summary now. A recoverable exploratory read miss does not make the task fail if the acceptance criteria were otherwise satisfied.",
              },
            ],
          }),
        });

        const finalPayload = await finalResponse.json();

        if (finalResponse.ok) {
          finalText = responseText(finalPayload) || "";
        }
      } catch {
        // Fall through to deterministic failure text below.
      }
    }

    if (!finalText) {
      finalText = approvalBlocked
        ? "TASK_STATUS: BLOCKED\nThis task is waiting for approval before Korben can continue."
        : executionFailed
          ? "TASK_STATUS: FAILED\nThis task stopped because a required tool call failed."
          : "TASK_STATUS: FAILED\nThe agent exhausted its execution budget and could not produce a final verified task result.";
    }

    const statusMatch = finalText.match(/^TASK_STATUS:\s*(COMPLETE|BLOCKED|FAILED)\s*\n?/i);
    const declaredStatus = statusMatch?.[1]?.toUpperCase() || "";
    const cleanedFinalText = statusMatch
      ? finalText.slice(statusMatch[0].length).trim()
      : finalText.trim();

    if (statusMatch) {
      finalText = cleanedFinalText || "Task completed.";
    }

    const finalStatus = approvalBlocked
      ? "waiting_approval"
      : declaredStatus === "BLOCKED"
        ? "blocked"
        : declaredStatus === "FAILED"
          ? "error"
          : declaredStatus === "COMPLETE"
            ? "complete"
            : executionFailed
              ? "error"
              : hadRecoverableToolFailure
                ? "error"
                : "complete";

    await Promise.all([
      supabase
        .from("agent_runs")
        .update({
          status: finalStatus,
          output: { summary: finalText },
          completed_at:
            finalStatus === "waiting_approval" ? null : new Date().toISOString(),
        })
        .eq("id", runId),
      supabase
        .from("tasks")
        .update({
          status:
            finalStatus === "waiting_approval"
              ? "awaiting_approval"
              : finalStatus === "complete"
                ? "complete"
                : finalStatus === "blocked"
                  ? "blocked"
                  : "failed",
          result_summary: finalText,
          progress_message:
            finalStatus === "waiting_approval"
              ? "Waiting for your approval."
              : finalStatus === "complete"
                ? `${task.stage || "Operate"} complete · ${finalText.slice(0, 220)}`
                : `Blocked · ${finalText.slice(0, 220)}`,
          last_heartbeat_at: new Date().toISOString(),
          completed_at:
            finalStatus === "complete" || finalStatus === "blocked"
              ? new Date().toISOString()
              : null,
        })
        .eq("id", task.id),
      supabase.from("agents").update({ status: "idle" }).eq("id", agent.id),
      supabase.from("run_events").insert({
        run_id: runId,
        project_id: project.id,
        task_id: task.id,
        agent_id: agent.id,
        event_type: "agent_finished",
        status: finalStatus,
        message: finalText,
        payload: {
          approval_blocked: approvalBlocked,
          execution_failed: executionFailed,
        },
      }),
    ]);

    return NextResponse.json({
      run_id: runId,
      status: finalStatus,
      summary: finalText,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Agent run failed.";

    await Promise.all([
      supabase
        .from("agent_runs")
        .update({
          status: "error",
          error: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId),
      supabase
        .from("tasks")
        .update({
          status: "failed",
          result_summary: message,
          progress_message: `Blocked · ${message.slice(0, 220)}`,
          last_heartbeat_at: new Date().toISOString(),
        })
        .eq("id", task.id),
      supabase.from("agents").update({ status: "idle" }).eq("id", agent.id),
      supabase.from("run_events").insert({
        run_id: runId,
        project_id: project.id,
        task_id: task.id,
        agent_id: agent.id,
        event_type: "agent_failed",
        status: "error",
        message,
        payload: {},
      }),
    ]);

    return NextResponse.json({ error: message, run_id: runId }, { status: 502 });
  }
}
