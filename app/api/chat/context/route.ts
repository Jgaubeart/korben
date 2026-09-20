import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const KEEP_RECENT = 16;
const SUMMARIZE_BATCH = 40;

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

function extractText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();

  const item = payload?.output
    ?.flatMap((entry: any) => entry?.content || [])
    ?.find((entry: any) => entry?.type === "output_text");

  return String(item?.text || "").trim();
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const supabase = serverSupabase(token);
  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const conversationId = String(body?.conversation_id || "");

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required." }, { status: 400 });
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const { data: messages, error: messageError } = await supabase
    .from("messages")
    .select("id,role,content,created_at,message_attachments(file_name,mime_type)")
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true });

  if (messageError) {
    return NextResponse.json({ error: messageError.message }, { status: 500 });
  }

  const rows = messages || [];

  const { data: existingContext } = await supabase
    .from("conversation_contexts")
    .select("summary,summarized_through,summarized_message_count")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (rows.length <= KEEP_RECENT) {
    return NextResponse.json({
      summary: existingContext?.summary || "",
      recent_message_count: rows.length,
      summarized_message_count: existingContext?.summarized_message_count || 0,
    });
  }

  const cutoffIndex = Math.max(0, rows.length - KEEP_RECENT);
  const summarizable = rows.slice(0, cutoffIndex);

  const summarizedThrough = existingContext?.summarized_through
    ? new Date(existingContext.summarized_through).getTime()
    : 0;

  const newRows = summarizable.filter(
    (row) => new Date(row.created_at).getTime() > summarizedThrough
  );

  if (newRows.length < SUMMARIZE_BATCH && existingContext?.summary) {
    return NextResponse.json({
      summary: existingContext.summary,
      recent_message_count: KEEP_RECENT,
      summarized_message_count: existingContext.summarized_message_count || 0,
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      summary: existingContext?.summary || "",
      recent_message_count: KEEP_RECENT,
      summarized_message_count: existingContext?.summarized_message_count || 0,
    });
  }

  const transcript = newRows
    .map((row: any) => {
      const attachmentNames = (row.message_attachments || [])
        .map((attachment: any) => String(attachment.file_name || ""))
        .filter(Boolean);
      const attachmentNote = attachmentNames.length
        ? `\nATTACHMENTS: ${attachmentNames.join(", ")}`
        : "";
      return `${row.role.toUpperCase()}: ${String(row.content || "").slice(0, 4000)}${attachmentNote}`;
    })
    .join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:
        process.env.OPENAI_ORCHESTRATOR_MODEL ||
        process.env.OPENAI_VISION_MODEL ||
        "gpt-5.6-sol",
      reasoning: { effort: "none" },
      input: [
        {
          role: "system",
          content:
            "Maintain a compact rolling memory for Korben. Preserve durable user preferences, decisions, commitments, unresolved items, named entities, project context, and important results. Drop small talk, repetition, transient wording, and obsolete details. Never invent facts. Keep the summary under 900 words.",
        },
        {
          role: "user",
          content: [
            existingContext?.summary
              ? `Existing rolling summary:\n${existingContext.summary}`
              : "Existing rolling summary: none.",
            "New conversation segment:",
            transcript,
            "Return only the updated rolling summary.",
          ].join("\n\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    return NextResponse.json({
      summary: existingContext?.summary || "",
      recent_message_count: KEEP_RECENT,
      summarized_message_count: existingContext?.summarized_message_count || 0,
    });
  }

  const payload = await response.json().catch(() => ({}));
  const summary = extractText(payload) || existingContext?.summary || "";
  const lastSummarized = summarizable[summarizable.length - 1];

  await supabase.from("conversation_contexts").upsert({
    conversation_id: conversationId,
    summary,
    summarized_through: lastSummarized?.created_at || null,
    summarized_message_count: summarizable.length,
    updated_at: new Date().toISOString(),
  });

  return NextResponse.json({
    summary,
    recent_message_count: KEEP_RECENT,
    summarized_message_count: summarizable.length,
  });
}
