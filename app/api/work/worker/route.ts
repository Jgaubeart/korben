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
  enqueued_at?: string;
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

async function addReport(
  supabase: ReturnType<typeof supabaseFor>,
  message: WorkMessage,
  projectId: string,
  report: string,
  status: "complete" | "blocked" | "approval"
) {
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

  await supabase.from("activity_events").insert({
    project_id: projectId,
    objective_id: message.objective_id,
    event_type: `background_work_${status}`,
    message: report,
    metadata: { source: "vercel_queue" },
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
    .select("id,title,project_id,conversation_id,status")
    .eq("id", message.objective_id)
    .maybeSingle();

  if (objectiveError || !objective) {
    throw new Error("Background objective is unavailable.");
  }

  const { data: taskRows, error: taskError } = await supabase
    .from("tasks")
    .select(
      "id,title,status,sequence,assigned_agent_id,result_summary,started_at,completed_at"
    )
    .eq("objective_id", objective.id)
    .order("sequence");

  if (taskError) {
    throw new Error(taskError.message);
  }

  const tasks = taskRows || [];

  if (!tasks.length) {
    await addReport(
      supabase,
      message,
      objective.project_id,
      `I couldn't continue “${objective.title}” because there are no executable tasks attached to it.`,
      "blocked"
    );
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
      "blocked"
    );
    return;
  }

  const awaitingApproval = tasks.find(
    (task) => task.status === "awaiting_approval"
  );

  if (awaitingApproval) {
    const { data: approved } = await supabase
      .from("approvals")
      .select("id,status")
      .eq("task_id", awaitingApproval.id)
      .eq("status", "approved")
      .order("decided_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!approved) {
      await addReport(
        supabase,
        message,
        objective.project_id,
        `I’ve taken “${objective.title}” as far as I can for now. I need your approval for “${awaitingApproval.title}” before I continue.`,
        "approval"
      );
      return;
    }

    await supabase
      .from("tasks")
      .update({ status: "queued" })
      .eq("id", awaitingApproval.id)
      .eq("status", "awaiting_approval");
  }

  const { data: refreshedTasks } = await supabase
    .from("tasks")
    .select("id,title,status,sequence")
    .eq("objective_id", objective.id)
    .order("sequence");

  const ordered = refreshedTasks || [];
  const allComplete =
    ordered.length > 0 && ordered.every((task) => task.status === "complete");

  if (allComplete) {
    await supabase
      .from("objectives")
      .update({ status: "complete" })
      .eq("id", objective.id);

    await addReport(
      supabase,
      message,
      objective.project_id,
      `Done. I finished “${objective.title}.” All ${ordered.length} delegated step${ordered.length === 1 ? "" : "s"} are complete.`,
      "complete"
    );
    return;
  }

  const nextTask = ordered.find((task, index) => {
    if (task.status !== "queued") return false;
    return ordered
      .slice(0, index)
      .every((prior) => prior.status === "complete");
  });

  if (!nextTask) {
    const active = ordered.find((task) => task.status === "in_progress");
    if (active) return;

    await addReport(
      supabase,
      message,
      objective.project_id,
      `I’m paused on “${objective.title}” because I can’t find a runnable next step. I left the current state in Tasks.`,
      "blocked"
    );
    return;
  }

  const { data: pendingApproval } = await supabase
    .from("approvals")
    .select("id,risk_level,status")
    .eq("task_id", nextTask.id)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();

  if (pendingApproval) {
    await supabase
      .from("tasks")
      .update({ status: "awaiting_approval" })
      .eq("id", nextTask.id)
      .eq("status", "queued");

    await addReport(
      supabase,
      message,
      objective.project_id,
      `I’ve taken “${objective.title}” as far as I can for now. I need your approval for “${nextTask.title}” before I continue.`,
      "approval"
    );
    return;
  }

  const { data: claimed } = await supabase
    .from("tasks")
    .update({
      status: "in_progress",
      started_at: new Date().toISOString(),
    })
    .eq("id", nextTask.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();

  if (!claimed) {
    return;
  }

  await supabase.from("run_events").insert({
    project_id: objective.project_id,
    task_id: nextTask.id,
    event_type: "background_worker_claimed",
    status: "running",
    message: `Korben background worker started ${nextTask.title}`,
    payload: { source: "vercel_queue" },
  });

  const result = await runTask(nextTask.id, message.access_token);

  if (!result.ok && result.httpStatus === 401) {
    await supabase
      .from("tasks")
      .update({
        status: "queued",
        result_summary:
          "Background authentication expired before this step could start.",
      })
      .eq("id", nextTask.id);

    throw new Error("Background worker authentication expired.");
  }

  if (result.status === "waiting_approval") {
    await addReport(
      supabase,
      message,
      objective.project_id,
      `I need your approval before I can continue “${objective.title}.” The next protected step is “${nextTask.title}.”`,
      "approval"
    );
    return;
  }

  if (!result.ok || result.status !== "complete") {
    await addReport(
      supabase,
      message,
      objective.project_id,
      `I hit a blocker while working on “${objective.title}.” “${nextTask.title}” did not complete. I left the details in Tasks and Delegation.`,
      "blocked"
    );
    return;
  }

  await send(
    "korben-work",
    message,
    {
      idempotencyKey: `objective:${objective.id}:after:${nextTask.id}`,
      retentionSeconds: 604800,
    }
  );
});
