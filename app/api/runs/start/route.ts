import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

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


const TOOL_ACTION_GUIDE: Record<string, string> = {
  "github.read":
    "Valid actions: repo, file, branch, pull_request, commit, compare, workflow_run, workflow_jobs. Use commit to inspect an exact commit/ref. Use compare with {base, head} to verify ancestry, ahead/behind counts, and changed files. Use workflow_run with {run_id} to verify the exact Actions run SHA/status/conclusion, and workflow_jobs with {run_id} to verify job and step conclusions. Never use create/update/merge here.",
  "github.write":
    "Valid actions: create_branch, update_file, sync_branch. sync_branch may only merge main/master into an existing feature branch; it must never target main/master or force-reset history.",
  "github.pr":
    "Valid action: create only. Use this only to open a pull request; do not use it to list/read PRs.",
  "github.merge":
    "Valid action: merge only. This is L2 and requires explicit approval.",
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
      "id,title,description,status,sequence,acceptance_criteria,assigned_agent_id,objective_id"
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
        started_at: new Date().toISOString(),
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
      },
    }),
  ]);

  let knowledgeContext: any = null;

  if (allowedToolKeys.includes("knowledge.search")) {
    try {
      const knowledgeResponse = await fetch(
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
                  "Provider action. Examples: repo, file, branch, pull_request, commit, compare, workflow_run, workflow_jobs, create_branch, update_file, sync_branch, create, merge, project, deployments, deployment, deploy, select, insert, update, search.",
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
    "Never attempt to bypass an approval boundary.",
    "GitHub writes must use a feature branch, never main or master.",
    "If a required tool is unavailable or an approval is required, clearly state the blocker and stop.",
    "Recoverable exploratory misses such as a file path returning Not Found do not by themselves mean the task failed; continue if you can still satisfy the acceptance criteria.",
    "Your final response MUST begin with exactly one status line: TASK_STATUS: COMPLETE, TASK_STATUS: BLOCKED, or TASK_STATUS: FAILED.",
    "Use COMPLETE only when the acceptance criteria are satisfied. Use BLOCKED when required access, data, or approval is missing. Use FAILED when a non-recoverable execution error prevents completion.",
    "After the status line, return a concise completion summary including what changed and any remaining risk.",
    "",
    `Project: ${project.name}`,
    `GitHub repo: ${project.github_repo || "not configured"}`,
    `Vercel project: ${project.vercel_project_id || "not configured"}`,
    `Objective: ${objective.title}`,
    objective.description ? `Objective context: ${objective.description}` : "",
    `Task: ${task.title}`,
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

        const riskLevel = riskByTool[toolKey] ?? 3;
        let approvalId: string | null = null;

        if (riskLevel >= 2) {
          const { data: approval } = await supabase
            .from("approvals")
            .select("id,status,risk_level")
            .eq("task_id", task.id)
            .eq("status", "approved")
            .gte("risk_level", riskLevel)
            .order("decided_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          approvalId = approval?.id || null;

          if (!approvalId) {
            approvalBlocked = true;
            await supabase.from("run_events").insert({
              run_id: runId,
              project_id: project.id,
              task_id: task.id,
              agent_id: agent.id,
              event_type: "approval_required",
              tool_system_key: toolKey,
              status: "waiting_approval",
              message: `${toolKey} requires L${riskLevel} approval`,
              payload: { action },
            });
          }
        }

        const toolResponse = await fetch(
          `${new URL(request.url).origin}/api/tools/execute`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              tool_system_key: toolKey,
              agent_system_key: agent.system_key,
              project_id: project.id,
              task_id: task.id,
              run_id: runId,
              approval_id: approvalId,
              action,
              params,
            }),
          }
        );

        const result = await toolResponse.json().catch(() => ({
          error: "Tool returned an unreadable response.",
        }));

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
        ? "error"
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
                : "failed",
          result_summary: finalText,
          completed_at:
            finalStatus === "complete" ? new Date().toISOString() : null,
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
