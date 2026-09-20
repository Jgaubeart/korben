import { createClient } from "@supabase/supabase-js";
import { send } from "@vercel/queue";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

export async function POST(request: Request) {
  const token = bearerToken(request);

  if (!token) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json();
  const objectiveId = String(body?.objective_id || "");
  const conversationId = String(body?.conversation_id || "");
  const projectName = String(body?.project_name || "Korben");
  const reason = String(body?.reason || "initial");
  const resumeTaskId = body?.resume_task_id ? String(body.resume_task_id) : null;

  if (!objectiveId || !conversationId) {
    return NextResponse.json(
      { error: "objective_id and conversation_id are required." },
      { status: 400 }
    );
  }

  const supabase = serverSupabase(token);
  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const { data: objective, error: objectiveError } = await supabase
    .from("objectives")
    .select("id,title,conversation_id,project_id")
    .eq("id", objectiveId)
    .maybeSingle();

  if (objectiveError || !objective) {
    return NextResponse.json({ error: "Objective is unavailable." }, { status: 404 });
  }

  if (objective.conversation_id && objective.conversation_id !== conversationId) {
    return NextResponse.json({ error: "Conversation does not match objective." }, { status: 409 });
  }

  const idempotencyKey = resumeTaskId
    ? `objective:${objectiveId}:resume:${resumeTaskId}:${reason}`
    : `objective:${objectiveId}:initial`;

  const { messageId } = await send(
    "korben-work",
    {
      objective_id: objectiveId,
      conversation_id: conversationId,
      project_name: projectName,
      access_token: token,
      reason,
      resume_task_id: resumeTaskId,
      enqueued_at: new Date().toISOString(),
    },
    {
      idempotencyKey,
      retentionSeconds: 604800,
    }
  );

  await supabase.from("activity_events").insert({
    project_id: objective.project_id,
    objective_id: objective.id,
    event_type: "background_work_queued",
    message: `Background execution queued for ${objective.title}`,
    metadata: {
      message_id: messageId,
      reason,
      resume_task_id: resumeTaskId,
    },
  });

  return NextResponse.json({
    queued: true,
    message_id: messageId,
    objective_id: objectiveId,
  });
}
