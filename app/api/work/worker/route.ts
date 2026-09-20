import { createClient } from "@supabase/supabase-js";
import { handleCallback, send } from "@vercel/queue";

export const runtime = "nodejs";
export const maxDuration = 300;

type WorkMessage = {
  objective_id: string;
  conversation_id: string;
  project_name: string;
  access_token: string;
  reason?: string;
  resume_task_id?: string | null;
  target_task_id?: string | null;
  enqueued_at?: string;
};

type TaskRow = {
  id: string;
  title: string;
  status: string;
  sequence: number;
  depends_on: string[];
  stage: string | null;
  parallel_group: number;
  assigned_agent_id: string | null;
  result_summary: string | null;
  started_at: string | null;
  completed_at: string | null;
};

function supabaseFor(token: string) {
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

function appOrigin() {
  const host =
    process.env.VERCEL_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    "korbenos.com";
  return host.startsWith("http") ? host : `https://${host}`;
}

async function activeFocusSession(
  supabase: ReturnType<typeof supabaseFor>,
  projectId: string
) {
  const { data } = await supabase
    .from("focus_sessions")
    .select("id,status")
    .eq("project_id", projectId)
    .in("status", ["active", "paused"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data || null;
}

async function addReport(
  supabase: ReturnType<typeof supabaseFor>,
  message: WorkMessage,
  projectId: string,
  report: string,
  status: "complete" | "blocked" | "approval",
  objectiveTitle: string
) {
  const urgency = status === "complete" ? "normal" : "high";
  const focusSession = await activeFocusSession(supabase, projectId);
  const holdForFocus = Boolean(focusSession && urgency !== "high");

  const { data: existingNotification } = await supabase
    .from("notifications")
    .select("id")
    .eq("objective_id", message.objective_id)
    .eq("kind", `mission_${status}`)
    .eq("body", report)
    .limit(1)
    .maybeSingle();

  if (!existingNotification) {
    await supabase.from("notifications").insert({
      project_id: projectId,
      objective_id: message.objective_id,
      kind: `mission_${status}`,
      title:
        status === "complete"
          ? "Mission complete"
          : status === "approval"
            ? "Approval needed"
            : "Mission needs attention",
      body: report,
      urgency,
      status: holdForFocus ? "held" : "unread",
    });
  }

  if (!holdForFocus) {
    const { data: existing } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", message.conversation_id)
      .eq("content", report)
      .limit(1)
      .maybeSingle();

    if (!existing) {
      await supabase.from("messages").insert({
        conversation_id: message.conversation_id,
        role: "assistant",
        content: report,
        input_mode: "system",
      });
    }
  }

  await supabase
    .from("objectives")
    .update({
      report_back: report,
      last_reported_at: new Date().toISOString(),
      mission_summary: objectiveTitle,
    })
    .eq("id", message.objective_id);

  await supabase.from("activity_events").insert({
    project_id: projectId,
    objective_id: message.objective_id,
    event_type: `background_work_${status}`,
    message: report,
    metadata: {
      source: "vercel_queue",
      held_for_focus: holdForFocus,
    },
  });
}

async function runTask(taskId: string, token: string) {
  const response = await fetch(`${appOrigin()}/api/runs/start`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ task_id: taskId }),
  });

  const result = await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    httpStatus: response.status,
    status: String(result?.status || ""),
    summary: String(result?.summary || result?.error || ""),
  };
}

function dependenciesComplete(task: TaskRow, tasks: TaskRow[]) {
  if (Array.isArray(task.depends_on) && task.depends_on.length) {
    return task.depends_on.every((id) =>
      tasks.some((candidate) => candidate.id === id && candidate.status === "complete")
    );
  }

  if (task.parallel_group > 0) {
    const firstSequenceInGroup = Math.min(
      ...tasks
        .filter((candidate) => candidate.parallel_group === task.parallel_group)
        .map((candidate) => candidate.sequence)
    );

    return tasks
      .filter((candidate) => candidate.sequence < firstSequenceInGroup)
      .every((candidate) => candidate.status === "complete");
  }

  return tasks
    .filter((candidate) => candidate.sequence < task.sequence)
    .every((candidate) => candidate.status === "complete");
}

async function queueTask(
  objectiveId: string,
  taskId: string,
  message: WorkMessage,
  suffix: string
) {
  await send(
    "korben-work",
    {
      ...message,
      target_task_id: taskId,
      reason: suffix,
      enqueued_at: new Date().toISOString(),
    },
    {
      idempotencyKey: `objective:${objectiveId}:task:${taskId}:${suffix}`,
      retentionSeconds: 604800,
    }
  );
}

async function queueCoordinator(
  objectiveId: string,
  completedTaskId: string,
  message: WorkMessage
) {
  await send(
    "korben-work",
    {
      ...message,
      target_task_id: null,
      reason: `after:${completedTaskId}`,
      enqueued_at: new Date().toISOString(),
    },
    {
      idempotencyKey: `objective:${objectiveId}:after:${completedTaskId}`,
      retentionSeconds: 604800,
    }
  );
}

export const POST = handleCallback(async (rawMessage) => {
  const message = rawMessage as WorkMessage;

  if (
    !message?.objective_id ||
    !message?.conversation_id ||
    !message?.access_token
  ) {
    throw new Error("Invalid Korben work message.");
  }

  const supabase = supabaseFor(message.access_token);

  const { data: authData, error: authError } = await supabase.auth.getUser(
    message.access_token
  );

  if (authError || !authData.user) {
    throw new Error("Korben background worker session is no longer valid.");
  }

  const { data: objective, error: objectiveError } = await supabase
    .from("objectives")
    .select(
      "id,title,project_id,conversation_id,status,execution_mode,mission_summary"
    )
    .eq("id", message.objective_id)
    .maybeSingle();

  if (objectiveError || !objective) {
    throw new Error("Background objective is unavailable.");
  }

  const loadTasks = async () => {
    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id,title,status,sequence,depends_on,stage,parallel_group,assigned_agent_id,result_summary,started_at,completed_at"
      )
      .eq("objective_id", objective.id)
      .order("sequence");

    if (error) throw new Error(error.message);
    return (data || []) as TaskRow[];
  };

  let tasks = await loadTasks();

  if (!tasks.length) {
    await addReport(
      supabase,
      message,
      objective.project_id,
      `I couldn't continue “${objective.title}” because there are no executable tasks attached to it.`,
      "blocked",
      objective.mission_summary || objective.title
    );
    return;
  }

  if (message.target_task_id) {
    const task = tasks.find((candidate) => candidate.id === message.target_task_id);
    if (!task) return;

    if (task.status === "complete") {
      await queueCoordinator(objective.id, task.id, message);
      return;
    }

    if (!["queued", "awaiting_approval"].includes(task.status)) {
      return;
    }

    if (!dependenciesComplete(task, tasks)) {
      return;
    }

    const { data: pendingApproval } = await supabase
      .from("approvals")
      .select("id,status")
      .eq("task_id", task.id)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();

    if (pendingApproval) {
      await supabase
        .from("tasks")
        .update({
          status: "awaiting_approval",
          progress_message: "Waiting for your approval.",
          last_heartbeat_at: new Date().toISOString(),
        })
        .eq("id", task.id);

      await addReport(
        supabase,
        message,
        objective.project_id,
        `I’ve taken “${objective.title}” as far as I can for now. I need your approval for “${task.title}” before I continue.`,
        "approval",
        objective.mission_summary || objective.title
      );
      return;
    }

    if (task.status === "awaiting_approval") {
      const { data: approved } = await supabase
        .from("approvals")
        .select("id")
        .eq("task_id", task.id)
        .eq("status", "approved")
        .order("decided_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!approved) return;

      await supabase
        .from("tasks")
        .update({ status: "queued" })
        .eq("id", task.id)
        .eq("status", "awaiting_approval");
    }

    const now = new Date().toISOString();
    const { data: claimed } = await supabase
      .from("tasks")
      .update({
        status: "in_progress",
        started_at: task.started_at || now,
        progress_message: `Working · ${task.stage || "Operate"}`,
        last_heartbeat_at: now,
      })
      .eq("id", task.id)
      .in("status", ["queued", "awaiting_approval"])
      .select("id")
      .maybeSingle();

    if (!claimed) return;

    await supabase.from("run_events").insert({
      project_id: objective.project_id,
      task_id: task.id,
      event_type: "stage_started",
      status: "running",
      message: `${task.stage || "Operate"} · ${task.title}`,
      payload: {
        source: "vercel_queue",
        stage: task.stage || "Operate",
        parallel_group: task.parallel_group || 0,
      },
    });

    const result = await runTask(task.id, message.access_token);

    if (!result.ok && result.httpStatus === 401) {
      await supabase
        .from("tasks")
        .update({
          status: "queued",
          progress_message: "Paused because the runtime session expired.",
          result_summary:
            "Background authentication expired before this step could start.",
          last_heartbeat_at: new Date().toISOString(),
        })
        .eq("id", task.id);

      throw new Error("Background worker authentication expired.");
    }

    if (result.status === "waiting_approval") {
      await supabase
        .from("tasks")
        .update({
          progress_message: "Waiting for your approval.",
          last_heartbeat_at: new Date().toISOString(),
        })
        .eq("id", task.id);

      await addReport(
        supabase,
        message,
        objective.project_id,
        `I need your approval before I can continue “${objective.title}.” The protected step is “${task.title}.”`,
        "approval",
        objective.mission_summary || objective.title
      );
      return;
    }

    if (!result.ok || result.status !== "complete") {
      await supabase
        .from("tasks")
        .update({
          progress_message: result.summary || "This step hit a blocker.",
          last_heartbeat_at: new Date().toISOString(),
        })
        .eq("id", task.id);

      await supabase
        .from("objectives")
        .update({ status: "blocked" })
        .eq("id", objective.id);

      await addReport(
        supabase,
        message,
        objective.project_id,
        `I hit a blocker while working on “${objective.title}.” “${task.title}” did not complete. I left the details in Tasks and Delegation.`,
        "blocked",
        objective.mission_summary || objective.title
      );
      return;
    }

    await supabase
      .from("tasks")
      .update({
        progress_message: result.summary || `${task.stage || "Operate"} complete.`,
        last_heartbeat_at: new Date().toISOString(),
      })
      .eq("id", task.id);

    await queueCoordinator(objective.id, task.id, message);
    return;
  }

  const failed = tasks.find((task) => task.status === "failed");
  const rejected = tasks.find((task) => task.status === "rejected");

  if (failed || rejected) {
    const blockedTask = failed || rejected;

    await supabase
      .from("objectives")
      .update({ status: "blocked" })
      .eq("id", objective.id);

    await addReport(
      supabase,
      message,
      objective.project_id,
      `I hit a blocker while working on “${objective.title}.” “${blockedTask?.title || "A delegated step"}” needs attention. I left the details in Tasks and Delegation.`,
      "blocked",
      objective.mission_summary || objective.title
    );
    return;
  }

  for (const waiting of tasks.filter((task) => task.status === "awaiting_approval")) {
    const { data: approved } = await supabase
      .from("approvals")
      .select("id")
      .eq("task_id", waiting.id)
      .eq("status", "approved")
      .order("decided_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (approved) {
      await supabase
        .from("tasks")
        .update({
          status: "queued",
          progress_message: "Approved · queued to resume.",
          last_heartbeat_at: new Date().toISOString(),
        })
        .eq("id", waiting.id)
        .eq("status", "awaiting_approval");
    }
  }

  tasks = await loadTasks();

  const allComplete =
    tasks.length > 0 && tasks.every((task) => task.status === "complete");

  if (allComplete) {
    await supabase
      .from("objectives")
      .update({
        status: "complete",
        completed_at: new Date().toISOString(),
      })
      .eq("id", objective.id);

    await addReport(
      supabase,
      message,
      objective.project_id,
      `Done. I finished “${objective.title}.” All ${tasks.length} delegated step${tasks.length === 1 ? "" : "s"} are complete.`,
      "complete",
      objective.mission_summary || objective.title
    );
    return;
  }

  const activeTasks = tasks.filter((task) => task.status === "in_progress");
  if (activeTasks.length) {
    return;
  }

  const runnable = tasks.filter(
    (task) => task.status === "queued" && dependenciesComplete(task, tasks)
  );

  if (!runnable.length) {
    const waitingApproval = tasks.find((task) => task.status === "awaiting_approval");

    if (waitingApproval) {
      await addReport(
        supabase,
        message,
        objective.project_id,
        `I’ve taken “${objective.title}” as far as I can for now. I need your approval for “${waitingApproval.title}” before I continue.`,
        "approval",
        objective.mission_summary || objective.title
      );
      return;
    }

    await addReport(
      supabase,
      message,
      objective.project_id,
      `I’m paused on “${objective.title}” because I can’t find a runnable next step. I left the current state in Tasks.`,
      "blocked",
      objective.mission_summary || objective.title
    );
    return;
  }

  const first = runnable.sort((a, b) => a.sequence - b.sequence)[0];

  if (objective.execution_mode === "fleet" && first.parallel_group > 0) {
    const group = runnable.filter(
      (task) => task.parallel_group === first.parallel_group
    );

    await supabase
      .from("objectives")
      .update({ status: "in_progress" })
      .eq("id", objective.id);

    await Promise.all(
      group.map((task) =>
        queueTask(
          objective.id,
          task.id,
          message,
          `fleet:${first.parallel_group}`
        )
      )
    );

    await supabase.from("activity_events").insert({
      project_id: objective.project_id,
      objective_id: objective.id,
      event_type: "fleet_dispatched",
      message: `Korben dispatched ${group.length} agents in parallel.`,
      metadata: {
        parallel_group: first.parallel_group,
        task_ids: group.map((task) => task.id),
      },
    });

    return;
  }

  await supabase
    .from("objectives")
    .update({ status: "in_progress" })
    .eq("id", objective.id);

  await queueTask(objective.id, first.id, message, "sequential");
});
