import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BUCKET = "korben-chat-files";
const MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
  "text/html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  ...IMAGE_TYPES,
]);

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

function safeFileName(name: string) {
  const cleaned = name
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.slice(-120) || "attachment";
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

  const form = await request.formData();
  const file = form.get("file");
  const conversationId = String(form.get("conversation_id") || "");
  const messageId = String(form.get("message_id") || "") || null;

  if (!(file instanceof File) || !conversationId) {
    return NextResponse.json(
      { error: "file and conversation_id are required." },
      { status: 400 }
    );
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "This file type is not supported yet." },
      { status: 415 }
    );
  }

  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Files must be between 1 byte and 20 MB." },
      { status: 413 }
    );
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  if (messageId) {
    const { data: message } = await supabase
      .from("messages")
      .select("id")
      .eq("id", messageId)
      .eq("conversation_id", conversationId)
      .maybeSingle();

    if (!message) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }
  }

  const storagePath = `${authData.user.id}/${conversationId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: file.type,
      upsert: false,
    });

  if (storageError) {
    return NextResponse.json({ error: storageError.message }, { status: 500 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  let openaiFileId: string | null = null;
  const openaiInputType = IMAGE_TYPES.has(file.type) ? "input_image" : "input_file";

  if (apiKey) {
    const openaiForm = new FormData();
    openaiForm.append("purpose", IMAGE_TYPES.has(file.type) ? "vision" : "user_data");
    openaiForm.append("file", new File([bytes], file.name, { type: file.type }));

    const openaiResponse = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: openaiForm,
    });

    const openaiPayload = await openaiResponse.json().catch(() => ({}));

    if (!openaiResponse.ok || !openaiPayload?.id) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json(
        { error: openaiPayload?.error?.message || "OpenAI could not process this file." },
        { status: 502 }
      );
    }

    openaiFileId = String(openaiPayload.id);
  }

  const { data: attachment, error: insertError } = await supabase
    .from("message_attachments")
    .insert({
      conversation_id: conversationId,
      message_id: messageId,
      uploaded_by: authData.user.id,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      storage_path: storagePath,
      openai_file_id: openaiFileId,
      openai_input_type: openaiInputType,
    })
    .select(
      "id,conversation_id,message_id,file_name,mime_type,size_bytes,storage_path,openai_file_id,openai_input_type,created_at"
    )
    .single();

  if (insertError || !attachment) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json(
      { error: insertError?.message || "Could not save attachment metadata." },
      { status: 500 }
    );
  }

  return NextResponse.json({ attachment });
}
