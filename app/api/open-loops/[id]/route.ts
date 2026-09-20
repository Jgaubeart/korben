import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function serverSupabase(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) throw new Error("Supabase runtime configuration is missing.");

  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const projectId = String(body?.project_id || "");
  const action = String(body?.action || "");

  if (!id || !projectId || !["update_detail", "remove"].includes(action)) {
    return NextResponse.json({ error: "A valid item, project, and action are required." }, { status: 400 });
  }

  const supabase = serverSupabase(token);
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  let update: Record<string, string | null>;
  if (action === "update_detail") {
    const detail = String(body?.detail || "").trim();
    if (!detail) return NextResponse.json({ error: "Enter the missing details." }, { status: 400 });
    if (detail.length > 1000) {
      return NextResponse.json({ error: "Keep details to 1,000 characters or fewer." }, { status: 400 });
    }
    update = { detail };
  } else {
    update = {
      status: "closed",
      resolved_at: new Date().toISOString(),
      resolution: "Removed from the unresolved-items list by the user.",
    };
  }

  const { data, error } = await supabase
    .from("open_loops")
    .update(update)
    .eq("id", id)
    .eq("project_id", projectId)
    .in("status", ["open", "waiting"])
    .select("id,title,detail,status,waiting_on,due_at,created_at,resolved_at,resolution")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "The unresolved item could not be updated." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Unresolved item not found." }, { status: 404 });

  return NextResponse.json({ open_loop: data });
}
