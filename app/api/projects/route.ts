import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_SLUGS = new Set(["general-workspace", "korben-os"]);

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

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}

async function authenticated(request: Request) {
  const token = bearerToken(request);
  if (!token) return { error: "Authentication required.", status: 401 as const };

  const supabase = serverSupabase(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return { error: "Invalid session.", status: 401 as const };
  }

  return { supabase, user: data.user, token };
}

export async function POST(request: Request) {
  const auth = await authenticated(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body?.name || "").trim();
  const instructions = String(body?.setup_instructions || "").trim();
  const githubRepo = String(body?.github_repo || "").trim() || null;
  const vercelProjectId = String(body?.vercel_project_id || "").trim() || null;

  if (!name) {
    return NextResponse.json({ error: "Project name is required." }, { status: 400 });
  }

  const { data: defaultProject } = await auth.supabase
    .from("projects")
    .select("business_id")
    .eq("slug", "general-workspace")
    .maybeSingle();

  if (!defaultProject?.business_id) {
    return NextResponse.json(
      { error: "General Workspace is not configured correctly." },
      { status: 409 }
    );
  }

  const baseSlug = slugify(name) || "project";
  let slug = baseSlug;
  let suffix = 2;

  while (true) {
    const { data: existing } = await auth.supabase
      .from("projects")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (!existing) break;
    slug = `${baseSlug}-${suffix++}`;
  }

  const { data: project, error } = await auth.supabase
    .from("projects")
    .insert({
      business_id: defaultProject.business_id,
      name,
      slug,
      github_repo: githubRepo,
      vercel_project_id: vercelProjectId,
      setup_instructions: instructions || null,
      status: "active",
    })
    .select("id,name,slug,github_repo,vercel_project_id,setup_instructions,status")
    .single();

  if (error || !project) {
    return NextResponse.json(
      { error: error?.message || "Could not create project." },
      { status: 500 }
    );
  }

  return NextResponse.json({ project });
}

export async function PATCH(request: Request) {
  const auth = await authenticated(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => ({}));
  const id = String(body?.id || "");

  if (!id) {
    return NextResponse.json({ error: "Project id is required." }, { status: 400 });
  }

  const { data: existing } = await auth.supabase
    .from("projects")
    .select("id,slug")
    .eq("id", id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};

  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim();
  }
  if (typeof body.setup_instructions === "string") {
    updates.setup_instructions = body.setup_instructions.trim() || null;
  }
  if (typeof body.github_repo === "string") {
    updates.github_repo = body.github_repo.trim() || null;
  }
  if (typeof body.vercel_project_id === "string") {
    updates.vercel_project_id = body.vercel_project_id.trim() || null;
  }

  if (existing.slug === "general-workspace") {
    updates.github_repo = null;
    updates.vercel_project_id = null;
  }

  const { data: project, error } = await auth.supabase
    .from("projects")
    .update(updates)
    .eq("id", id)
    .select("id,name,slug,github_repo,vercel_project_id,setup_instructions,status")
    .single();

  if (error || !project) {
    return NextResponse.json(
      { error: error?.message || "Could not update project." },
      { status: 500 }
    );
  }

  return NextResponse.json({ project });
}

export async function DELETE(request: Request) {
  const auth = await authenticated(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => ({}));
  const id = String(body?.id || "");

  if (!id) {
    return NextResponse.json({ error: "Project id is required." }, { status: 400 });
  }

  const { data: project } = await auth.supabase
    .from("projects")
    .select("id,slug")
    .eq("id", id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  if (DEFAULT_SLUGS.has(project.slug)) {
    return NextResponse.json(
      { error: "Default projects cannot be deleted." },
      { status: 409 }
    );
  }

  const { error } = await auth.supabase.from("projects").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true, id });
}
