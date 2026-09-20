"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "../../lib/supabase/client";

type ProjectRecord = {
  id: string;
  name: string;
  slug: string;
  github_repo: string | null;
  vercel_project_id: string | null;
  setup_instructions: string | null;
  status: string;
};

const DEFAULT_SLUGS = new Set(["general-workspace", "korben-os"]);

export default function ProjectsPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [authReady, setAuthReady] = useState(false);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectSlug, setSelectedProjectSlug] = useState("general-workspace");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [vercelProjectId, setVercelProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    const { data } = await supabase
      .from("projects")
      .select("id,name,slug,github_repo,vercel_project_id,setup_instructions,status")
      .eq("status", "active")
      .order("name");

    const rows = (data || []) as ProjectRecord[];
    setProjects(rows);
    return rows;
  };

  useEffect(() => {
    const bootstrap = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        window.location.assign("/");
        return;
      }

      const rows = await refresh();
      const stored = window.localStorage.getItem("korben:selected-project") || "general-workspace";
      const selected =
        rows.find((project) => project.slug === stored) ||
        rows.find((project) => project.slug === "general-workspace") ||
        rows[0];

      if (selected) {
        setSelectedProjectSlug(selected.slug);
        window.localStorage.setItem("korben:selected-project", selected.slug);
      }

      setAuthReady(true);
    };

    void bootstrap();
  }, [supabase]);

  const resetForm = () => {
    setEditingProjectId(null);
    setName("");
    setInstructions("");
    setGithubRepo("");
    setVercelProjectId("");
    setError("");
  };

  const editProject = (project: ProjectRecord) => {
    setEditingProjectId(project.id);
    setName(project.name);
    setInstructions(project.setup_instructions || "");
    setGithubRepo(project.github_repo || "");
    setVercelProjectId(project.vercel_project_id || "");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Give the project a name.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in again to manage projects.");

      const response = await fetch("/api/projects", {
        method: editingProjectId ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: editingProjectId,
          name: name.trim(),
          setup_instructions: instructions,
          github_repo: githubRepo,
          vercel_project_id: vercelProjectId,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not save project.");

      const rows = await refresh();
      const saved = payload?.project as ProjectRecord | undefined;

      if (saved && !editingProjectId) {
        setSelectedProjectSlug(saved.slug);
        window.localStorage.setItem("korben:selected-project", saved.slug);
      } else if (!rows.some((project) => project.slug === selectedProjectSlug)) {
        const fallback = rows.find((project) => project.slug === "general-workspace") || rows[0];
        if (fallback) {
          setSelectedProjectSlug(fallback.slug);
          window.localStorage.setItem("korben:selected-project", fallback.slug);
        }
      }

      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save project.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (project: ProjectRecord) => {
    if (DEFAULT_SLUGS.has(project.slug)) return;

    if (!window.confirm(`Delete ${project.name}? Project-scoped Korben history will be removed too.`)) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in again to manage projects.");

      const response = await fetch("/api/projects", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: project.id }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not delete project.");

      const rows = await refresh();

      if (selectedProjectSlug === project.slug) {
        const fallback = rows.find((item) => item.slug === "general-workspace") || rows[0];
        if (fallback) {
          setSelectedProjectSlug(fallback.slug);
          window.localStorage.setItem("korben:selected-project", fallback.slug);
        }
      }

      if (editingProjectId === project.id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete project.");
    } finally {
      setBusy(false);
    }
  };

  const switchProject = (slug: string) => {
    setSelectedProjectSlug(slug);
    window.localStorage.setItem("korben:selected-project", slug);
  };

  const editingProject = projects.find((project) => project.id === editingProjectId);
  const currentProject = projects.find((project) => project.slug === selectedProjectSlug);

  if (!authReady) {
    return <main className="auth-shell zen-auth-shell"><div className="zen-auth-wordmark">KORBEN</div></main>;
  }

  return (
    <main className="zen-app-page project-manager-page">
      <header className="korben-home-nav zen-app-nav">
        <button className="korben-home-wordmark" onClick={() => window.location.assign("/")}>KORBEN</button>
        <nav className="korben-home-links zen-app-links" aria-label="Primary navigation">
          <button onClick={() => window.location.assign("/")}>Home</button>
          <button className="active">Projects</button>
        </nav>
        <div className="korben-home-account">
          <span className="presence-dot present" />
          <label className="project-switcher-wrap">
            <span>Project</span>
            <select
              value={selectedProjectSlug}
              onChange={(event) => switchProject(event.target.value)}
              aria-label="Choose active project"
            >
              {projects.map((project) => (
                <option value={project.slug} key={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          <button className="account-trigger" onClick={() => window.location.assign("/")}>Jordan <span>⌄</span></button>
        </div>
      </header>

      <section className="zen-page-wrap project-manager-wrap">
        <div className="zen-page-kicker">
          <button onClick={() => window.location.assign("/")}>← Home</button>
          <span>Workspace</span>
          <i />
          <strong>Projects</strong>
        </div>

        <section className="project-manager-heading">
          <div>
            <span className="eyebrow">PROJECT CONTROL</span>
            <h1>Projects</h1>
            <p>Only configured projects exist inside Korben. Each project carries its own setup instructions and optional system connections.</p>
          </div>
          <div className="project-manager-current">
            <small>ACTIVE PROJECT</small>
            <strong>{currentProject?.name || "General Workspace"}</strong>
          </div>
        </section>

        <div className="project-manager-grid">
          <section className="project-list-panel">
            <div className="project-panel-head">
              <div>
                <span className="eyebrow">CONFIGURED</span>
                <h2>{projects.length} project{projects.length === 1 ? "" : "s"}</h2>
              </div>
              <button onClick={resetForm}>+ Add project</button>
            </div>

            <div className="project-card-list">
              {projects.map((project) => {
                const isDefault = DEFAULT_SLUGS.has(project.slug);
                const isActive = selectedProjectSlug === project.slug;

                return (
                  <article className={`project-card ${isActive ? "active" : ""}`} key={project.id}>
                    <div className="project-card-top">
                      <div>
                        <span className="project-card-kicker">
                          {isDefault ? "DEFAULT" : "PROJECT"} {isActive ? "· ACTIVE" : ""}
                        </span>
                        <h3>{project.name}</h3>
                      </div>
                      <div className="project-card-actions">
                        {!isActive && <button onClick={() => switchProject(project.slug)}>Use</button>}
                        <button onClick={() => editProject(project)}>Edit</button>
                        {!isDefault && <button className="danger" onClick={() => void remove(project)}>Delete</button>}
                      </div>
                    </div>

                    <p>{project.setup_instructions || "No setup instructions yet."}</p>

                    <div className="project-connection-row">
                      <span className={project.github_repo ? "connected" : ""}>
                        GitHub · {project.github_repo || "Not connected"}
                      </span>
                      <span className={project.vercel_project_id ? "connected" : ""}>
                        Vercel · {project.vercel_project_id || "Not connected"}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="project-editor-panel">
            <div className="project-panel-head">
              <div>
                <span className="eyebrow">{editingProjectId ? "EDIT PROJECT" : "NEW PROJECT"}</span>
                <h2>{editingProjectId ? "Update workspace" : "Add a project"}</h2>
              </div>
              {editingProjectId && <button onClick={resetForm}>Cancel</button>}
            </div>

            <label className="project-field">
              <span>Project name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name" />
            </label>

            <label className="project-field">
              <span>Setup instructions</span>
              <textarea
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                rows={9}
                placeholder="Explain what this project is, what Korben may control, important boundaries, repository expectations, deployment rules, and anything agents need to know."
              />
              <small>Korben receives these instructions when it routes work into this project.</small>
            </label>

            <label className="project-field">
              <span>GitHub repository</span>
              <input
                value={githubRepo}
                onChange={(event) => setGithubRepo(event.target.value)}
                placeholder="owner/repository"
                disabled={editingProject?.slug === "general-workspace"}
              />
            </label>

            <label className="project-field">
              <span>Vercel project ID</span>
              <input
                value={vercelProjectId}
                onChange={(event) => setVercelProjectId(event.target.value)}
                placeholder="prj_..."
                disabled={editingProject?.slug === "general-workspace"}
              />
            </label>

            {editingProject?.slug === "general-workspace" && (
              <div className="project-boundary-note">
                General Workspace intentionally has no GitHub or Vercel target. It is the neutral space for project-agnostic assistant work.
              </div>
            )}

            {error && <div className="project-form-error">{error}</div>}

            <button className="project-save-button" onClick={() => void save()} disabled={busy || !name.trim()}>
              {busy ? "Saving…" : editingProjectId ? "Save changes" : "Create project"}
            </button>
          </section>
        </div>
      </section>
    </main>
  );
}
