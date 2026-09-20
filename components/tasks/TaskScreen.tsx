"use client";

import { useEffect, useMemo, useState } from "react";

export type TaskScreenTask = {
  id: string; title: string; description: string | null; status: string; sequence: number;
  assigned_agent_id?: string | null; result_summary?: string | null; started_at?: string | null;
  completed_at?: string | null; stage?: string | null; parallel_group?: number;
  progress_message?: string | null; last_heartbeat_at?: string | null;
};

type Props = {
  tasks: TaskScreenTask[]; objective: string; missionSummary: string; projectName: string;
  executionMode: "sequential" | "fleet"; loading?: boolean; error?: string | null;
  agentName?: (id: string | null | undefined) => string; onRetry?: () => void; onExit?: () => void;
};

const activeStates = new Set(["queued", "in_progress", "awaiting_approval"]);
const label = (value: string) => value.replaceAll("_", " ");

export function TaskScreen({ tasks, objective, missionSummary, projectName, executionMode, loading = false, error, agentName, onRetry, onExit }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [mobileDetail, setMobileDetail] = useState(false);
  const filtered = useMemo(() => tasks.filter((task) => filter === "all" || (filter === "active" ? activeStates.has(task.status) : task.status === filter)), [tasks, filter]);
  const selected = tasks.find((task) => task.id === selectedId) || filtered[0] || null;
  const complete = tasks.filter((task) => task.status === "complete").length;

  useEffect(() => { if (!selectedId && filtered[0]) setSelectedId(filtered[0].id); }, [filtered, selectedId]);

  const choose = (id: string) => { setSelectedId(id); setMobileDetail(true); };

  return <section className={`task-screen ${mobileDetail ? "show-detail" : ""}`} aria-label="Task workspace">
    <header className="task-screen-header">
      <button className="task-icon-button" onClick={() => mobileDetail ? setMobileDetail(false) : onExit?.()} aria-label="Back">←</button>
      <div className="task-heading"><span>Tasks · {projectName}</span><strong>{objective || "No active objective"}</strong><small>{missionSummary || "Mission workspace"}</small></div>
      <div className="task-header-meta"><span>{complete}/{tasks.length} complete</span><span>{executionMode} mode</span></div>
    </header>
    <div className="task-screen-body">
      <aside className="task-navigator">
        <div className="task-filter-row">{["all", "active", "awaiting_approval", "complete", "failed"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{label(item)}</button>)}</div>
        {loading ? <div className="task-state"><span className="task-skeleton" /><span className="task-skeleton" /><span className="task-skeleton" />Loading tasks…</div> : error ? <div className="task-state error"><strong>Unable to load tasks</strong><p>{error}</p>{onRetry && <button onClick={onRetry}>Retry</button>}</div> : !tasks.length ? <div className="task-state"><strong>No tasks yet</strong><p>This objective has no task steps.</p></div> : !filtered.length ? <div className="task-state"><strong>No matching tasks</strong><button onClick={() => setFilter("all")}>Clear filters</button></div> : <div className="task-list">{filtered.map((task) => <button key={task.id} className={`task-list-item ${selected?.id === task.id ? "active" : ""}`} onClick={() => choose(task.id)}><span className="task-sequence">{String(task.sequence).padStart(2, "0")}</span><span><strong>{task.title}</strong><small>{task.stage || "Execution"} · {agentName?.(task.assigned_agent_id) || "Unassigned"}</small></span><em className={`task-status status-${task.status}`}>{label(task.status)}</em></button>)}</div>}
      </aside>
      <main className="task-workspace">{selected ? <><div className="task-detail-title"><div><span>Task {selected.sequence} · {selected.stage || "Execution"}</span><h1>{selected.title}</h1></div><em className={`task-status status-${selected.status}`}>{label(selected.status)}</em></div>
        {selected.status === "awaiting_approval" && <div className="task-alert approval"><strong>Awaiting approval</strong><p>This task is paused until its governed approval is resolved.</p></div>}
        {selected.status === "failed" && <div className="task-alert failure"><strong>Execution failed</strong><p>{selected.result_summary || "Review activity for the latest failure detail."}</p></div>}
        <section className="task-detail-card"><span>Overview</span><p>{selected.description || "No task description was provided."}</p></section>
        <section className="task-detail-card"><span>Current progress</span><h3>{selected.progress_message || label(selected.status)}</h3><p>Agent: {agentName?.(selected.assigned_agent_id) || "Unassigned"}{selected.last_heartbeat_at ? ` · Last update ${new Date(selected.last_heartbeat_at).toLocaleString()}` : ""}</p></section>
        <section className="task-detail-card"><span>Result & evidence</span><p>{selected.result_summary || (selected.status === "complete" ? "Completed without a result summary." : "Evidence will appear when execution produces a result.")}</p></section></> : <div className="task-state task-select-state"><strong>Select a task</strong><p>Choose a task from the navigator to inspect execution details.</p></div>}</main>
      <aside className="task-inspector"><span>Activity</span><h2>Mission context</h2><p>{missionSummary || "No mission summary available."}</p><dl><div><dt>Project</dt><dd>{projectName}</dd></div><div><dt>Execution</dt><dd>{executionMode}</dd></div><div><dt>Active</dt><dd>{tasks.filter((task) => activeStates.has(task.status)).length}</dd></div></dl></aside>
    </div>
  </section>;
}
