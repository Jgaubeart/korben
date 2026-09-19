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

const riskByTool: Record<string, number> = {
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
      "id,title,description,status,acceptance_criteria,assigned_agent_id,objective_id"
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
                  "Provider action. Examples: repo, file, branch, pull_request, create_branch, update_file, create, merge, project, deployments, deployment, deploy, select, insert, update.",
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
    "Never attempt to bypass an approval boundary.",
    "GitHub writes must use a feature branch, never main or master.",
    "If a required tool is unavailable or an approval is required, clearly state the blocker and stop.",
    "When the task is complete, return a concise completion summary including what changed and any remaining risk.",
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
  const maxTurns = 8;
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
            executionFailed = true;
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

    if (!finalText) {
      finalText = approvalBlocked
        ? "This task is waiting for approval before Korben can continue."
        : executionFailed
          ? "This task stopped because a required tool call failed."
          : "The agent reached its turn limit before completing the task.";
    }

    const finalStatus = approvalBlocked
      ? "waiting_approval"
      : executionFailed
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
