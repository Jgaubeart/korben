"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TaskScreen, type TaskScreenTask } from "../../components/tasks/TaskScreen";
import { createBrowserSupabaseClient } from "../../lib/supabase/client";

type Objective = { id: string; title: string; summary: string | null; execution_mode: "sequential" | "fleet"; project_id: string | null };
type Project = { id: string; name: string };
type Agent = { id: string; name: string };

export default function TasksPage() {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [tasks, setTasks] = useState<TaskScreenTask[]>([]);
  const [objective, setObjective] = useState<Objective | null>(null);
  const [projectName, setProjectName] = useState("General Workspace");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true); setError(null);
      const { data: auth } = await supabase.auth.getSession();
      if (!auth.session) { if (active) { setError("Sign in to view the task workspace."); setLoading(false); } return; }
      const [{ data: objectives, error: objectiveError }, { data: agentRows }] = await Promise.all([
        supabase.from("objectives").select("id,title,summary,execution_mode,project_id").order("created_at", { ascending: false }).limit(1),
        supabase.from("agents").select("id,name"),
      ]);
      if (!active) return;
      if (objectiveError) { setError(objectiveError.message); setLoading(false); return; }
      const current = objectives?.[0] as Objective | undefined;
      setObjective(current || null); setAgents((agentRows || []) as Agent[]);
      if (!current) { setTasks([]); setLoading(false); return; }
      const [{ data: taskRows, error: taskError }, projectResult] = await Promise.all([
        supabase.from("tasks").select("id,title,description,status,sequence,assigned_agent_id,result_summary,started_at,completed_at,stage,parallel_group,progress_message,last_heartbeat_at").eq("objective_id", current.id).order("sequence"),
        current.project_id ? supabase.from("projects").select("id,name").eq("id", current.project_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (!active) return;
      if (taskError) setError(taskError.message); else setTasks((taskRows || []) as TaskScreenTask[]);
      if (projectResult.data) setProjectName((projectResult.data as Project).name);
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [refreshKey, supabase]);

  return <TaskScreen tasks={tasks} objective={objective?.title || "No active objective"} missionSummary={objective?.summary || ""} projectName={projectName} executionMode={objective?.execution_mode || "sequential"} loading={loading} error={error} onRetry={() => setRefreshKey((value) => value + 1)} onExit={() => router.push("/")} agentName={(id) => agents.find((agent) => agent.id === id)?.name || "Unassigned"} />;
}
