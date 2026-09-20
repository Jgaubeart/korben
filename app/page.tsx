"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserSupabaseClient } from "../lib/supabase/client";
import { AmbientScene } from "../components/ambient/AmbientScene";
import { SpiritOrb } from "../components/orb/SpiritOrb";
import { getAmbientState, getGreetingForHour, getSimulatedTime } from "../lib/ambient-time";

type Message = {
  id?: string;
  role: "user" | "assistant";
  text: string;
  inputMode?: "text" | "voice";
};

type Agent = {
  id: string;
  name: string;
  role: string;
  status: string;
  system_key: string;
  department_id?: string | null;
};

type Department = {
  id: string;
  name: string;
  slug: string;
};

type ProjectRecord = {
  id: string;
  name: string;
  slug: string;
  github_repo: string | null;
  vercel_project_id: string | null;
};

type ToolRecord = {
  id: string;
  system_key: string;
  name: string;
  provider: string;
  description: string | null;
  status: string;
  risk_level: number;
};

type AgentToolPermission = {
  agent_id: string;
  tool_id: string;
  max_approval_level: number;
};

type ApprovalRecord = {
  id: string;
  objective_id: string;
  task_id: string | null;
  action_type: string;
  risk_level: number;
  status: string;
  created_at: string;
};

type IntegrationStatus = {
  openai: boolean;
  supabase: boolean;
  github: boolean;
  vercel: boolean;
  gbrain: boolean;
  obsidian: boolean;
};

type PreflightCheck = {
  key: string;
  label: string;
  status: "healthy" | "warning" | "error" | "not_configured";
  detail: string;
};

type PreflightReport = {
  checked_at: string;
  overall: "healthy" | "degraded" | "error";
  project: {
    id: string;
    name: string;
    slug: string;
    github_repo: string | null;
    vercel_project_id: string | null;
  };
  checks: PreflightCheck[];
};

type RunEvent = {
  id: string;
  run_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  event_type: string;
  tool_system_key: string | null;
  status: string;
  message: string | null;
  created_at: string;
};

type KnowledgeSource = {
  id: string;
  name: string;
  provider: string;
  status: string;
  connection_type: string;
  last_sync_at: string | null;
  last_error: string | null;
};

type KnowledgeEntry = {
  id: string;
  project_id: string | null;
  source_id: string | null;
  entry_type: "document" | "sop" | "memory" | "decision" | "fact";
  title: string;
  content: string;
  status: string;
  tags: string[];
  updated_at: string;
};

type PlannedTask = {
  title: string;
  description: string;
  agent_system_key: string;
  acceptance_criteria: string[];
  approval_level: number;
};

type OrchestrationPlan = {
  intent: "conversation" | "question" | "work" | "action" | "approval";
  requires_execution: boolean;
  target_project_slug: string;
  title: string;
  summary: string;
  assistant_reply: string;
  tasks: PlannedTask[];
};

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  sequence: number;
  assigned_agent_id?: string | null;
  result_summary?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

const normalizeKorbenName = (value: string) =>
  value.replace(/\bcorbin\b/gi, (match) =>
    match[0] === match[0]?.toUpperCase() ? "Korben" : "korben"
  );

const toSpokenReply = (value: string) => {
  const cleaned = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b[a-f0-9]{7,40}\b/gi, " ")
    .replace(/[_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter(Boolean);
  if (words.length <= 45) return cleaned;
  return `${words.slice(0, 45).join(" ")}…`;
};

const KORBEN_VOICE_STORAGE_KEY = "korben:voice-uri";

const chooseKorbenVoice = (voices: SpeechSynthesisVoice[]) => {
  if (!voices.length) return null;

  const savedUri =
    typeof window !== "undefined"
      ? window.localStorage.getItem(KORBEN_VOICE_STORAGE_KEY)
      : null;

  const savedVoice = savedUri
    ? voices.find((voice) => voice.voiceURI === savedUri)
    : null;

  const preferredVoice =
    savedVoice ||
    voices.find((voice) => /Google UK English Male/i.test(voice.name)) ||
    voices.find((voice) => /Microsoft.*(Guy|Ryan|Mark|David)/i.test(voice.name)) ||
    voices.find((voice) => /male/i.test(voice.name)) ||
    voices.find((voice) => /^en(-|_)?US/i.test(voice.lang)) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ||
    null;

  if (preferredVoice && typeof window !== "undefined") {
    window.localStorage.setItem(KORBEN_VOICE_STORAGE_KEY, preferredVoice.voiceURI);
  }

  return preferredVoice;
};

const resolveKorbenVoice = async () => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return null;
  }

  const synth = window.speechSynthesis;
  const immediate = chooseKorbenVoice(synth.getVoices());
  if (immediate) return immediate;

  return await new Promise<SpeechSynthesisVoice | null>((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(chooseKorbenVoice(synth.getVoices()));
    };

    const handleVoicesChanged = () => finish();

    synth.addEventListener("voiceschanged", handleVoicesChanged, { once: true });
    window.setTimeout(finish, 900);
  });
};

const fallbackGreeting: Message = {
  role: "assistant",
  text: "Good morning. I’m Korben. What can I help you with today?",
};

export default function Home() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [input, setInput] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([fallbackGreeting]);
  const [activeView, setActiveView] = useState<"command" | "network" | "work" | "workstream" | "runs" | "brain" | "sops" | "tools" | "integrations" | "focus" | "preflight">("command");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectSlug, setSelectedProjectSlug] = useState(() => {
    if (typeof window === "undefined") return "general-workspace";
    return window.localStorage.getItem("korben:selected-project") || "general-workspace";
  });
  const [currentProjectName, setCurrentProjectName] = useState("General Workspace");
  const [tools, setTools] = useState<ToolRecord[]>([]);
  const [agentToolPermissions, setAgentToolPermissions] = useState<AgentToolPermission[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);
  const [preflightReport, setPreflightReport] = useState<PreflightReport | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [focusGoal, setFocusGoal] = useState("");
  const [focusMinutes, setFocusMinutes] = useState(30);
  const [focusRemaining, setFocusRemaining] = useState(0);
  const [focusRunning, setFocusRunning] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const [focusLockTab, setFocusLockTab] = useState(false);
  const [focusInterruptions, setFocusInterruptions] = useState(0);
  const [focusReport, setFocusReport] = useState<string | null>(null);
  const [focusStreak, setFocusStreak] = useState(() => {
    if (typeof window === "undefined") return 0;
    return Number(window.localStorage.getItem("korben:focus-streak") || "0");
  });
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeObjective, setActiveObjective] = useState<string>("No active objective");
  const [activeObjectiveId, setActiveObjectiveId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loadingState, setLoadingState] = useState("Connecting…");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [calmMode, setCalmMode] = useState(false);
  const [voiceState, setVoiceState] = useState<"waiting" | "listening" | "thinking" | "speaking">("waiting");
  const [conversationActive, setConversationActive] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");
  const [ambientClock, setAmbientClock] = useState(() => new Date());
  const recognitionRef = useRef<any>(null);
  const heldShortcutRef = useRef(false);
  const sendingRef = useRef(false);
  const voiceModeRef = useRef(false);
  const voiceSubmittedRef = useRef(false);
  const wakeDetectedRef = useRef(false);
  const conversationActiveRef = useRef(false);
  const conversationTimeoutRef = useRef<number | null>(null);
  const sendMessageRef = useRef<(messageText?: string, mode?: "text" | "voice") => Promise<void>>(
    async () => {}
  );

  useEffect(() => {
    const resolveAmbientClock = () => {
      const simulated = getSimulatedTime(
        new URLSearchParams(window.location.search).get("ambientTime")
      );
      setAmbientClock(simulated || new Date());
    };

    resolveAmbientClock();
    const interval = window.setInterval(resolveAmbientClock, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setSignedIn(false);
        setAuthReady(true);
        setLoadingState("Sign in required");
        return;
      }

      setSignedIn(true);
      setAuthReady(true);

      const { data: projectRows } = await supabase
        .from("projects")
        .select("id,name,slug,github_repo,vercel_project_id")
        .eq("status", "active")
        .order("name");

      setProjects(projectRows || []);

      const { data: project } = await supabase
        .from("projects")
        .select("id,name,slug,github_repo,vercel_project_id")
        .eq("slug", selectedProjectSlug)
        .single();

      if (!project) {
        setLoadingState("Project not found");
        return;
      }

      setProjectId(project.id);
      setCurrentProjectName(project.name);

      const { data: departmentRows } = await supabase
        .from("departments")
        .select("id,name,slug")
        .order("name");

      setDepartments(departmentRows || []);

      const { data: agentRows } = await supabase
        .from("agents")
        .select("id,name,role,status,system_key,department_id")
        .order("name");

      setAgents(agentRows || []);

      const { data: toolRows } = await supabase
        .from("tools")
        .select("id,system_key,name,provider,description,status,risk_level")
        .order("provider")
        .order("name");

      setTools(toolRows || []);

      const { data: permissionRows } = await supabase
        .from("agent_tool_permissions")
        .select("agent_id,tool_id,max_approval_level");

      setAgentToolPermissions(permissionRows || []);

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (accessToken) {
        try {
          const statusResponse = await fetch("/api/tools/status", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (statusResponse.ok) {
            setIntegrationStatus(await statusResponse.json());
          }
        } catch {
          setIntegrationStatus(null);
        }
      }

      let currentConversationId: string | null = null;
      const { data: existingConversation } = await supabase
        .from("conversations")
        .select("id,title")
        .eq("project_id", project.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingConversation) {
        currentConversationId = existingConversation.id;
      } else {
        const { data: created } = await supabase
          .from("conversations")
          .insert({
            project_id: project.id,
            title: "Command Center",
          })
          .select("id")
          .single();
        currentConversationId = created?.id || null;
      }

      setConversationId(currentConversationId);

      if (currentConversationId) {
        const { data: history } = await supabase
          .from("messages")
          .select("id,role,content,input_mode,created_at")
          .eq("conversation_id", currentConversationId)
          .in("role", ["user", "assistant"])
          .order("created_at", { ascending: true });

        if (history && history.length) {
          setMessages(
            history.map((row) => ({
              id: row.id,
              role: row.role as "user" | "assistant",
              text: row.content,
              inputMode: row.input_mode === "voice" ? "voice" : "text",
            }))
          );
        }
      }

      const { data: objective } = await supabase
        .from("objectives")
        .select("id,title,status,created_at")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (objective) {
        setActiveObjective(objective.title);
        setActiveObjectiveId(objective.id);
        const { data: taskRows } = await supabase
          .from("tasks")
          .select("id,title,description,status,sequence,assigned_agent_id,result_summary,started_at,completed_at")
          .eq("objective_id", objective.id)
          .order("sequence");
        setTasks(taskRows || []);
      }

      const { data: projectObjectives } = await supabase
        .from("objectives")
        .select("id")
        .eq("project_id", project.id);

      const objectiveIds = (projectObjectives || []).map((row) => row.id);

      if (objectiveIds.length) {
        const { data: approvalRows } = await supabase
          .from("approvals")
          .select("id,objective_id,task_id,action_type,risk_level,status,created_at")
          .in("objective_id", objectiveIds)
          .order("created_at", { ascending: false });

        setApprovals(approvalRows || []);
      } else {
        setApprovals([]);
      }

      const { data: eventRows } = await supabase
        .from("run_events")
        .select("id,run_id,task_id,agent_id,event_type,tool_system_key,status,message,created_at")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(100);

      setRunEvents(eventRows || []);

      const { data: sourceRows } = await supabase
        .from("knowledge_sources")
        .select("id,name,provider,status,connection_type,last_sync_at,last_error")
        .order("name");

      setKnowledgeSources(sourceRows || []);

      const { data: entryRows } = await supabase
        .from("knowledge_entries")
        .select("id,project_id,source_id,entry_type,title,content,status,tags,updated_at")
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(250);

      setKnowledgeEntries(
        (entryRows || []).filter(
          (entry) => !entry.project_id || entry.project_id === project.id
        ) as KnowledgeEntry[]
      );

      setLoadingState("System online");
    };

    bootstrap();
  }, [supabase, selectedProjectSlug]);

  useEffect(() => {
    if (!projectId || !signedIn) return;

    let cancelled = false;

    const refreshWorkstream = async () => {
      const { data: objective } = await supabase
        .from("objectives")
        .select("id,title")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled || !objective) return;

      const [{ data: taskRows }, { data: eventRows }, { data: agentRows }] = await Promise.all([
        supabase
          .from("tasks")
          .select("id,title,description,status,sequence,assigned_agent_id,result_summary,started_at,completed_at")
          .eq("objective_id", objective.id)
          .order("sequence"),
        supabase
          .from("run_events")
          .select("id,run_id,task_id,agent_id,event_type,tool_system_key,status,message,created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("agents")
          .select("id,name,role,status,system_key,department_id")
          .order("name"),
      ]);

      if (cancelled) return;
      setActiveObjective(objective.title);
      setActiveObjectiveId(objective.id);
      setTasks((taskRows || []) as Task[]);
      setRunEvents((eventRows || []) as RunEvent[]);
      setAgents((agentRows || []) as Agent[]);
    };

    void refreshWorkstream();
    const interval = window.setInterval(refreshWorkstream, 3500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [projectId, signedIn, supabase]);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onstart = () => {
      setListening(true);
    };

    recognition.onend = () => {
      setListening(false);

      if (
        voiceModeRef.current &&
        !sendingRef.current &&
        !window.speechSynthesis?.speaking
      ) {
        window.setTimeout(() => {
          try {
            recognition.start();
          } catch {}
        }, 450);
      }
    };

    recognition.onerror = () => {
      setListening(false);
    };

    recognition.onresult = (event: any) => {
      let transcript = "";
      let hasFinalResult = false;

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          hasFinalResult = true;
        }
      }

      const normalized = normalizeKorbenName(transcript.trim());

      if (!conversationActiveRef.current) {
        if (/\bkorben\b/i.test(normalized)) {
          conversationActiveRef.current = true;
          setConversationActive(true);
          wakeDetectedRef.current = true;
          voiceSubmittedRef.current = false;
          setVoiceState("listening");
          setInputMode("voice");
          clearConversationTimeout();

          const remainder = normalized
            .replace(/^.*?\bkorben\b[\s,.:;!?-]*/i, "")
            .trim();

          setInput(remainder);

          if (hasFinalResult && remainder && !sendingRef.current) {
            voiceSubmittedRef.current = true;
            try {
              recognition.stop();
            } catch {}
            void sendMessageRef.current(remainder, "voice");
          }
        }
        return;
      }

      const spokenText = normalized.trim();

      if (/^(korben[\s,.:;!?-]*)?(go to sleep|sleep|standby|stop listening)$/i.test(spokenText)) {
        try {
          recognition.stop();
        } catch {}
        returnToWakeStandby();
        return;
      }

      if (spokenText) {
        clearConversationTimeout();
        setVoiceState("listening");
        setInput(spokenText);
      }

      if (
        hasFinalResult &&
        spokenText &&
        !voiceSubmittedRef.current &&
        !sendingRef.current
      ) {
        voiceSubmittedRef.current = true;
        try {
          recognition.stop();
        } catch {}
        void sendMessageRef.current(spokenText, "voice");
      }
    };
    recognitionRef.current = recognition;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.code === "Space" && !event.repeat) {
        event.preventDefault();
        conversationActiveRef.current = true;
        setConversationActive(true);
        wakeDetectedRef.current = true;
        clearConversationTimeout();
        setVoiceState("listening");
        setInputMode("voice");
        try {
          recognition.start();
        } catch {}
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      try {
        recognition.stop();
      } catch {}
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (!focusRunning || focusPaused) return;

    const timer = window.setInterval(() => {
      setFocusRemaining((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          setFocusRunning(false);
          setFocusPaused(false);
          setFocusLockTab(false);

          const nextStreak = focusStreak + 1;
          setFocusStreak(nextStreak);
          window.localStorage.setItem("korben:focus-streak", String(nextStreak));

          setFocusReport(
            `Focus session complete — ${focusMinutes} minutes on ${focusGoal || "your priority"}, with ${focusInterruptions} detected tab drift${focusInterruptions === 1 ? "" : "s"}.`
          );

          if ("speechSynthesis" in window && voiceModeRef.current) {
            const utterance = new SpeechSynthesisUtterance(
              `Focus session complete. ${focusInterruptions} interruptions detected.`
            );
            utterance.rate = 0.96;
            window.speechSynthesis.speak(utterance);
          }

          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [
    focusRunning,
    focusPaused,
    focusMinutes,
    focusGoal,
    focusInterruptions,
    focusStreak,
  ]);

  useEffect(() => {
    const handleVisibility = () => {
      if (!focusRunning || focusPaused || !focusLockTab || !document.hidden) return;

      setFocusInterruptions((count) => count + 1);

      if ("speechSynthesis" in window && voiceModeRef.current) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(
          "Focus drift detected. Return to the locked Korben tab when you are ready."
        );
        utterance.rate = 0.96;
        window.speechSynthesis.speak(utterance);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [focusRunning, focusPaused, focusLockTab]);

  const clearConversationTimeout = () => {
    if (conversationTimeoutRef.current) {
      window.clearTimeout(conversationTimeoutRef.current);
      conversationTimeoutRef.current = null;
    }
  };

  const returnToWakeStandby = () => {
    clearConversationTimeout();
    conversationActiveRef.current = false;
    setConversationActive(false);
    wakeDetectedRef.current = false;
    voiceSubmittedRef.current = false;
    setInput("");
    setVoiceState("waiting");

    if (voiceModeRef.current && speechSupported) {
      window.setTimeout(() => {
        try {
          recognitionRef.current?.start();
        } catch {}
      }, 350);
    }
  };

  const armConversationTimeout = () => {
    clearConversationTimeout();
    conversationTimeoutRef.current = window.setTimeout(() => {
      returnToWakeStandby();
    }, 30000);
  };

  const signIn = async () => {
    const email = loginEmail.trim();

    if (!email || !loginPassword) {
      setLoginError("Enter your email and password.");
      return;
    }

    setLoginBusy(true);
    setLoginError("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: loginPassword,
    });

    if (error) {
      setLoginError(error.message);
      setLoginBusy(false);
      return;
    }

    setSignedIn(true);
    setLoginPassword("");
    setLoadingState("Connecting…");
    setLoginBusy(false);
    window.location.reload();
  };

  const signOut = async () => {
    clearConversationTimeout();
    await supabase.auth.signOut();
    setSignedIn(false);
    setMessages([fallbackGreeting]);
    setTasks([]);
    setProjectId(null);
    setConversationId(null);
    setActiveObjective("No active objective");
    setLoadingState("Sign in required");
  };

  const runPreflight = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) return;

    setPreflightBusy(true);

    try {
      const response = await fetch(
        `/api/health/preflight${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      );

      if (response.ok) {
        setPreflightReport(await response.json());
      }
    } finally {
      setPreflightBusy(false);
    }
  };

  const startFocus = () => {
    const minutes = Math.max(1, Math.min(240, Number(focusMinutes) || 30));
    setFocusMinutes(minutes);
    setFocusRemaining(minutes * 60);
    setFocusInterruptions(0);
    setFocusReport(null);
    setFocusPaused(false);
    setFocusRunning(true);
    setLoadingState("Focus session active");
  };

  const endFocus = () => {
    const elapsedSeconds = Math.max(0, focusMinutes * 60 - focusRemaining);
    const elapsedMinutes = Math.max(1, Math.round(elapsedSeconds / 60));

    setFocusRunning(false);
    setFocusPaused(false);
    setFocusLockTab(false);
    setFocusReport(
      `Focus session ended after ${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} on ${focusGoal || "your priority"}, with ${focusInterruptions} detected tab drift${focusInterruptions === 1 ? "" : "s"}.`
    );
    setLoadingState("System online");
  };

  const toggleVoiceMode = () => {
    const next = !voiceMode;
    voiceModeRef.current = next;
    setVoiceMode(next);
    clearConversationTimeout();

    if (!next) {
      conversationActiveRef.current = false;
      setConversationActive(false);
      wakeDetectedRef.current = false;
      voiceSubmittedRef.current = false;
      setVoiceState("waiting");
      setInput("");
      window.speechSynthesis?.cancel();
      try {
        recognitionRef.current?.stop();
      } catch {}
      return;
    }

    conversationActiveRef.current = false;
    setConversationActive(false);
    wakeDetectedRef.current = false;
    voiceSubmittedRef.current = false;
    setVoiceState("waiting");

    if (speechSupported) {
      window.setTimeout(() => {
        try {
          recognitionRef.current?.start();
        } catch {}
      }, 250);
    }
  };

  const fallbackPlan = (requestText: string): OrchestrationPlan => ({
    intent: "work",
    requires_execution: false,
    target_project_slug:
      selectedProjectSlug === "general-workspace" ? "" : selectedProjectSlug,
    title: requestText.length > 72 ? `${requestText.slice(0, 69)}…` : requestText,
    summary: requestText,
    assistant_reply:
      "I could not reach the intent router, so I preserved this as structured work without executing any external action.",
    tasks: [
      {
        title: "Product Spec",
        description: "Define requirements and acceptance criteria",
        agent_system_key: "product_manager",
        acceptance_criteria: ["Requirements are explicit and testable."],
        approval_level: 0,
      },
      {
        title: "Architecture Review",
        description: "Map dependencies and implementation path",
        agent_system_key: "solutions_architect",
        acceptance_criteria: ["Architecture and dependencies are documented."],
        approval_level: 0,
      },
      {
        title: "Build",
        description: "Implement the requested change on a feature branch",
        agent_system_key: "frontend_engineer",
        acceptance_criteria: ["Requested behavior is implemented."],
        approval_level: 1,
      },
      {
        title: "QA & Security",
        description: "Test behavior, permissions and regressions",
        agent_system_key: "qa_engineer",
        acceptance_criteria: ["Acceptance criteria pass without critical regressions."],
        approval_level: 0,
      },
      {
        title: "Preview Deploy",
        description: "Ship a Vercel preview for owner review",
        agent_system_key: "devops_engineer",
        acceptance_criteria: ["A preview deployment is available for review."],
        approval_level: 1,
      },
    ],
  });

  const ensureWorkspace = async (): Promise<{ projectId: string; conversationId: string }> => {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      throw new Error("You are not signed in to Korben. Sign in first, then try again.");
    }

    let resolvedProjectId = projectId;

    if (!resolvedProjectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id")
        .eq("slug", selectedProjectSlug)
        .single();

      if (projectError || !project) {
        throw new Error("Korben could not load the current project.");
      }

      resolvedProjectId = project.id;
      setProjectId(project.id);
    }

    if (!resolvedProjectId) {
      throw new Error("Korben could not resolve the current project.");
    }

    let resolvedConversationId = conversationId;

    if (!resolvedConversationId) {
      const { data: existingConversation } = await supabase
        .from("conversations")
        .select("id")
        .eq("project_id", resolvedProjectId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingConversation) {
        resolvedConversationId = existingConversation.id;
      } else {
        const { data: createdConversation, error: conversationError } = await supabase
          .from("conversations")
          .insert({
            project_id: resolvedProjectId,
            title: "Command Center",
          })
          .select("id")
          .single();

        if (conversationError || !createdConversation) {
          throw new Error("Korben could not start a conversation.");
        }

        resolvedConversationId = createdConversation.id;
      }

      if (resolvedConversationId) {
        setConversationId(resolvedConversationId);
      }
    }

    if (!resolvedConversationId) {
      throw new Error("Korben could not resolve the current conversation.");
    }

    return {
      projectId: resolvedProjectId,
      conversationId: resolvedConversationId,
    };
  };

  const switchProject = (slug: string) => {
    if (!slug || slug === selectedProjectSlug) return;
    window.localStorage.setItem("korben:selected-project", slug);
    setSelectedProjectSlug(slug);
    setProjectId(null);
    setConversationId(null);
    setTasks([]);
    setActiveObjective("No active objective");
    setActiveObjectiveId(null);
    setMessages([fallbackGreeting]);
    setLoadingState("Switching workspace…");
  };

  const enqueueObjectiveWork = async ({
    objectiveId,
    conversationIdForWork,
    projectName,
    reason = "initial",
    resumeTaskId = null,
  }: {
    objectiveId: string;
    conversationIdForWork: string;
    projectName: string;
    reason?: string;
    resumeTaskId?: string | null;
  }) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setLoadingState("Sign in required");
      return false;
    }

    const response = await fetch("/api/work/enqueue", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        objective_id: objectiveId,
        conversation_id: conversationIdForWork,
        project_name: projectName,
        reason,
        resume_task_id: resumeTaskId,
      }),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setLoadingState(result?.error || "Could not queue background work");
      return false;
    }

    setLoadingState("Agents working in background…");
    return true;
  };

  const approveAction = async (approval: ApprovalRecord) => {
    const decidedAt = new Date().toISOString();

    const { error } = await supabase
      .from("approvals")
      .update({
        status: "approved",
        decided_at: decidedAt,
        decision_note: "Approved by owner in Korben OS",
      })
      .eq("id", approval.id);

    if (error) return;

    setApprovals((current) =>
      current.map((item) =>
        item.id === approval.id ? { ...item, status: "approved" } : item
      )
    );

    if (!approval.task_id || !approval.objective_id || !conversationId) return;

    await supabase
      .from("tasks")
      .update({ status: "queued" })
      .eq("id", approval.task_id);

    setTasks((current) =>
      current.map((item) =>
        item.id === approval.task_id ? { ...item, status: "queued" } : item
      )
    );

    await enqueueObjectiveWork({
      objectiveId: approval.objective_id,
      conversationIdForWork: conversationId,
      projectName: currentProjectName,
      reason: `approval:${approval.id}:${decidedAt}`,
      resumeTaskId: approval.task_id,
    });
  };

  const rejectAction = async (approval: ApprovalRecord) => {
    await supabase
      .from("approvals")
      .update({
        status: "rejected",
        decided_at: new Date().toISOString(),
        decision_note: "Rejected by owner in Korben OS",
      })
      .eq("id", approval.id);

    setApprovals((current) =>
      current.map((item) =>
        item.id === approval.id ? { ...item, status: "rejected" } : item
      )
    );

    if (approval.task_id) {
      await supabase
        .from("tasks")
        .update({ status: "rejected" })
        .eq("id", approval.task_id);

      setTasks((current) =>
        current.map((item) =>
          item.id === approval.task_id ? { ...item, status: "rejected" } : item
        )
      );
    }
  };

  const executeTaskQueue = async (
    createdTasks: Task[],
    _plannedTasks: PlannedTask[],
    conversationIdForWork: string,
    projectNameForWork: string,
    objectiveIdForWork: string
  ) => {
    if (!createdTasks.length) return;

    const queued = await enqueueObjectiveWork({
      objectiveId: objectiveIdForWork,
      conversationIdForWork,
      projectName: projectNameForWork,
    });

    if (!queued) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: "I created the work, but the background worker could not start. I left the tasks queued so they can be resumed safely.",
        },
      ]);
    }
  };

  const sendMessage = async (
    messageText?: string,
    mode?: "text" | "voice"
  ) => {
    const text = normalizeKorbenName((messageText ?? input).trim());
    if (!text || sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);
    setInput("");
    setLoadingState("Korben is thinking…");
    setVoiceState("thinking");
    const currentInputMode = mode ?? inputMode;
    const userMessage: Message = { role: "user", text, inputMode: currentInputMode };
    setMessages((current) => [...current, userMessage]);

    let resolvedProjectId: string;
    let resolvedConversationId: string;

    try {
      const workspace = await ensureWorkspace();
      resolvedProjectId = workspace.projectId;
      resolvedConversationId = workspace.conversationId;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Korben could not connect to the workspace.";
      setMessages((current) => [
        ...current,
        { role: "assistant", text: message },
      ]);
      setLoadingState("Connection required");
      sendingRef.current = false;
      setSending(false);
      return;
    }

    const { data: insertedMessage } = await supabase
      .from("messages")
      .insert({
        conversation_id: resolvedConversationId,
        role: "user",
        content: text,
        input_mode: currentInputMode,
      })
      .select("id")
      .single();

    let plan = fallbackPlan(text);

    try {
      const planResponse = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: text,
          projectName: currentProjectName,
          currentProjectSlug: selectedProjectSlug,
          projects: projects.map((project) => ({
            name: project.name,
            slug: project.slug,
            github_repo: project.github_repo,
            vercel_project_id: project.vercel_project_id,
          })),
          recentMessages: messages.slice(-12).map((message) => ({
            role: message.role,
            content: message.text,
          })),
        }),
      });

      if (planResponse.ok) {
        plan = (await planResponse.json()) as OrchestrationPlan;
      }
    } catch (error) {
      console.error("Korben planning failed; using fallback plan.", error);
    }

    const currentProject = projects.find(
      (project) => project.id === resolvedProjectId
    );

    const routedProject = plan.target_project_slug
      ? projects.find((project) => project.slug === plan.target_project_slug)
      : currentProject && currentProject.slug !== "general-workspace"
        ? currentProject
        : null;

    const needsScopedProject = ["work", "action", "approval"].includes(plan.intent);

    if (needsScopedProject && !routedProject) {
      plan = {
        ...plan,
        requires_execution: false,
        assistant_reply:
          plan.assistant_reply ||
          "I can do that, but I need to know which project or business this work belongs to.",
        tasks: [],
      };
    }

    const executionProjectId = routedProject?.id || resolvedProjectId;
    const executionProjectName = routedProject?.name || currentProjectName;

    if (routedProject && routedProject.id !== resolvedProjectId && plan.tasks.length > 0) {
      setLoadingState(`Routing to ${routedProject.name}…`);
    }

    let objective: { id: string; title: string } | null = null;
    let createdTasks: Task[] = [];

    if (plan.tasks.length > 0 && !["conversation", "question"].includes(plan.intent)) {
      const { data: createdObjective } = await supabase
        .from("objectives")
        .insert({
          project_id: executionProjectId,
          conversation_id:
            executionProjectId === resolvedProjectId ? resolvedConversationId : null,
          title: plan.title,
          description: plan.summary || text,
          status: "planned",
          priority: "normal",
        })
        .select("id,title")
        .single();

      objective = createdObjective;
    }

    if (objective) {
      setActiveObjective(objective.title);
      setActiveObjectiveId(objective.id);

      const taskRows = plan.tasks.map((task, index) => ({
        objective_id: objective.id,
        assigned_agent_id:
          agents.find((agent) => agent.system_key === task.agent_system_key)?.id || null,
        title: task.title,
        description: task.description,
        status: "queued",
        sequence: index + 1,
        acceptance_criteria: task.acceptance_criteria,
      }));

      const { data } = await supabase
        .from("tasks")
        .insert(taskRows)
        .select("id,title,description,status,sequence,assigned_agent_id")
        .order("sequence");

      createdTasks = data || [];
      setTasks(createdTasks);

      const approvals = plan.tasks.flatMap((task, index) => {
        const createdTask = createdTasks[index];

        if (task.approval_level < 2 || !createdTask) {
          return [];
        }

        return [
          {
            objective_id: objective.id,
            task_id: createdTask.id,
            action_type: task.title,
            risk_level: task.approval_level,
            status: "pending",
            request_payload: {
              description: task.description,
              agent_system_key: task.agent_system_key,
            },
          },
        ];
      });

      if (approvals.length) {
        await supabase.from("approvals").insert(approvals);
      }

      const orchestrator = agents.find((agent) => agent.system_key === "orchestrator");
      await supabase.from("agent_runs").insert({
        agent_id: orchestrator?.id || null,
        status: "complete",
        model: "gpt-5.6-sol",
        input: {
          request: text,
          input_mode: currentInputMode,
          command_center_project: currentProject?.slug || selectedProjectSlug,
          target_project: routedProject?.slug || null,
        },
        output: {
          ...plan,
          resolved_project_name: executionProjectName,
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
    }

    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", resolvedConversationId);

    const reply = plan.assistant_reply;
    const assistantMessage: Message = { role: "assistant", text: reply };
    setMessages((current) => [...current, assistantMessage]);

    await supabase.from("messages").insert({
      conversation_id: resolvedConversationId,
      role: "assistant",
      content: reply,
      input_mode: "system",
    });

    await supabase.from("activity_events").insert([
      {
        project_id: resolvedProjectId,
        objective_id:
          executionProjectId === resolvedProjectId ? objective?.id || null : null,
        event_type: "message_received",
        message: "New Command Center request received",
        metadata: {
          input_mode: currentInputMode,
          message_id: insertedMessage?.id || null,
          target_project_slug: routedProject?.slug || null,
        },
      },
      {
        project_id: executionProjectId,
        objective_id: objective?.id || null,
        event_type: "plan_generated",
        message: objective
          ? `Execution plan generated for ${executionProjectName}: ${objective.title}`
          : "Planning attempted",
        metadata: {
          task_count: createdTasks.length,
          intent: plan.intent,
          requires_execution: plan.requires_execution,
          target_project_slug: routedProject?.slug || null,
        },
      },
    ]);

    setInputMode("text");
    setLoadingState("System online");
    sendingRef.current = false;
    setSending(false);

    if (
      objective &&
      plan.requires_execution &&
      createdTasks.length > 0 &&
      ["work", "action", "approval"].includes(plan.intent)
    ) {
      void executeTaskQueue(
        createdTasks,
        plan.tasks,
        resolvedConversationId,
        executionProjectName,
        objective.id
      );
    }

    if (voiceModeRef.current && "speechSynthesis" in window) {
      setVoiceState("speaking");
      window.speechSynthesis.cancel();

      const spokenReply = toSpokenReply(reply);
      const utterance = new SpeechSynthesisUtterance(spokenReply);
      utterance.rate = 0.98;
      utterance.pitch = 0.9;

      const preferredVoice = await resolveKorbenVoice();

      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      const resumeConversation = () => {
        voiceSubmittedRef.current = false;

        if (conversationActiveRef.current) {
          setVoiceState("listening");
          armConversationTimeout();

          window.setTimeout(() => {
            try {
              recognitionRef.current?.start();
            } catch {}
          }, 500);
        } else {
          returnToWakeStandby();
        }
      };

      utterance.onend = resumeConversation;
      utterance.onerror = resumeConversation;
      window.speechSynthesis.speak(utterance);
    } else {
      voiceSubmittedRef.current = false;
      if (conversationActiveRef.current) {
        setVoiceState("listening");
        armConversationTimeout();
        window.setTimeout(() => {
          try {
            recognitionRef.current?.start();
          } catch {}
        }, 350);
      } else {
        returnToWakeStandby();
      }
    }
  };

  sendMessageRef.current = sendMessage;

  useEffect(() => {
    if (!signedIn || !conversationId || !activeObjectiveId || !tasks.length) return;
    if (tasks.some((task) => task.status === "in_progress")) return;

    const ordered = [...tasks].sort((a, b) => a.sequence - b.sequence);
    const hasRunnableQueuedTask = ordered.some((task, index) =>
      task.status === "queued" &&
      ordered.slice(0, index).every((prior) => prior.status === "complete")
    );

    if (!hasRunnableQueuedTask) return;

    const recoveryKey = `korben:background-recovery:${activeObjectiveId}`;
    if (window.sessionStorage.getItem(recoveryKey) === "1") return;
    window.sessionStorage.setItem(recoveryKey, "1");

    void enqueueObjectiveWork({
      objectiveId: activeObjectiveId,
      conversationIdForWork: conversationId,
      projectName: currentProjectName,
      reason: "browser-recovery",
    });
  }, [activeObjectiveId, conversationId, currentProjectName, signedIn, tasks]);

  const completedTasks = tasks.filter((task) => task.status === "complete").length;
  const progress = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0;
  const focusClock = `${String(Math.floor(focusRemaining / 60)).padStart(2, "0")}:${String(
    focusRemaining % 60
  ).padStart(2, "0")}`;
  const runtimeState =
    approvals.some((approval) => approval.status === "pending")
      ? "Blocked · approval"
      : tasks.some((task) => task.status === "in_progress")
        ? "Executing"
        : focusRunning
          ? focusPaused
            ? "Focus paused"
            : "Focus active"
          : voiceState === "thinking"
            ? "Thinking"
            : voiceState === "speaking"
              ? "Speaking"
              : voiceState === "listening"
                ? "Listening"
                : loadingState;

  if (!authReady) {
    return (
      <main className="auth-shell zen-auth-shell">
        <div className="zen-auth-wordmark">KORBEN</div>
        <div className="auth-card zen-auth-card zen-auth-loading">
          <div className="zen-auth-presence" aria-hidden="true">
            <span className="zen-auth-ring zen-auth-ring-outer">
              <i className="zen-auth-node zen-auth-node-left" />
              <i className="zen-auth-node zen-auth-node-right" />
            </span>
            <span className="zen-auth-ring zen-auth-ring-inner" />
            <span className="zen-auth-pearl" />
          </div>
          <p className="auth-status">Connecting to Korben…</p>
        </div>
        <div className="zen-auth-footer">A CALMER, BRIGHTER YOU.</div>
      </main>
    );
  }

  if (!signedIn) {
    return (
      <main className="auth-shell zen-auth-shell">
        <div className="zen-auth-wordmark">KORBEN</div>

        <div className="auth-card zen-auth-card">
          <div className="zen-auth-presence" aria-hidden="true">
            <span className="zen-auth-ring zen-auth-ring-outer">
              <i className="zen-auth-node zen-auth-node-left" />
              <i className="zen-auth-node zen-auth-node-right" />
            </span>
            <span className="zen-auth-ring zen-auth-ring-inner" />
            <span className="zen-auth-pearl" />
          </div>

          <div className="auth-copy zen-auth-copy">
            <span className="kicker">WELCOME BACK</span>
            <h1>Sign in to Korben.</h1>
            <p>Your private space to think, plan, and get things done.</p>
          </div>

          <div className="auth-form zen-auth-form">
            <label>
              Email
              <input
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    signIn();
                  }
                }}
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </label>
            {loginError && <div className="auth-error">{loginError}</div>}
            <button className="auth-submit zen-auth-submit" onClick={signIn} disabled={loginBusy}>
              {loginBusy ? "Signing in…" : "Enter Korben"}
            </button>
          </div>
        </div>

        <div className="zen-auth-footer">A CALMER, BRIGHTER YOU.</div>
      </main>
    );
  }

  const statusCopy =
    voiceState === "listening"
      ? "Listening"
      : voiceState === "thinking"
        ? "Thinking"
        : voiceState === "speaking"
          ? "Speaking"
          : voiceMode
            ? conversationActive
              ? "Conversation open"
              : "Say “Korben”"
            : "Voice standby";

  const agentById = (id?: string | null) =>
    id ? agents.find((agent) => agent.id === id) : undefined;

  const viewTitle =
    activeView === "command" ? "Command Center" :
    activeView === "network" ? "Agent Network" :
    activeView === "work" ? "Work Routing" :
    activeView === "workstream" ? "Delegation Feed" :
    activeView === "runs" ? "Runs & Activity" :
    activeView === "brain" ? "Brain & Memory" :
    activeView === "sops" ? "SOP Library" :
    activeView === "tools" ? "Tool Registry" :
    activeView === "integrations" ? "Integrations" :
    activeView === "focus" ? "Focus" :
    "Preflight";

  const currentTask =
    tasks.find((task) => task.status === "in_progress") ||
    tasks.find((task) => task.status === "awaiting_approval") ||
    tasks.find((task) => task.status === "queued");
  const currentAgent = agentById(currentTask?.assigned_agent_id);
  const latestRunEvent = runEvents[0];
  const workingAgentCount = agents.filter((agent) => agent.status === "working").length;
  const hasPendingApproval = approvals.some((approval) => approval.status === "pending");
  const coreMode = hasPendingApproval
    ? "blocked"
    : tasks.some((task) => task.status === "in_progress")
      ? "executing"
      : focusRunning && !focusPaused
        ? "focus"
        : voiceState;

  const todayEvents = [
    ["8:30", "Team standup", "work"],
    ["10:00", "Client strategy call", "work"],
    ["11:30", "Review contract", "work"],
    ["1:00", "Lunch", "personal"],
    ["2:30", "Prepare proposal", "focus"],
    ["4:00", "Gym", "personal"],
  ];

  const priorityItems = [
    ["Prepare proposal", "Due today · High impact"],
    ["Review contract", "Due today"],
    ["Plan next campaign", "This week"],
  ];

  const communicationItems = [
    ["Natalie", "Re: Proposal looks great!", "8:47 AM", "mail"],
    ["Client Team", "Upcoming call agenda", "8:12 AM", "team"],
    ["Mom", "Dinner this weekend?", "7:34 AM", "text"],
    ["Travel", "Your flight is confirmed", "7:14 AM", "travel"],
  ];

  const dashboardTasks = tasks.length
    ? tasks.slice(0, 6)
    : [
        { id: "mock-1", title: "Draft client email", status: "complete", sequence: 1 },
        { id: "mock-2", title: "Review contract", status: "complete", sequence: 2 },
        { id: "mock-3", title: "Prepare proposal", status: "queued", sequence: 3 },
        { id: "mock-4", title: "Book flight to Atlanta", status: "queued", sequence: 4 },
        { id: "mock-5", title: "Set gym reminder", status: "queued", sequence: 5 },
      ] as Task[];

  const dashboardCompleted = dashboardTasks.filter((task) => task.status === "complete").length;
  const dashboardProgress = dashboardTasks.length
    ? Math.round((dashboardCompleted / dashboardTasks.length) * 100)
    : 0;

  const orbState =
    tasks.some((task) => task.status === "in_progress")
      ? "working"
      : voiceState === "thinking"
        ? "thinking"
        : voiceState === "speaking"
          ? "responding"
          : voiceState === "listening"
            ? "listening"
            : "idle";

  const compactStatus = hasPendingApproval
    ? "A protected action needs your approval."
    : currentTask?.status === "in_progress"
      ? `${currentAgent?.name || "Korben"} is handling ${currentTask.title.toLowerCase()}.`
      : sending
        ? "Reviewing your request."
        : voiceState === "listening"
          ? "I’m listening."
          : "Reviewing inbox priorities · 2 agents active";

  const renderOrb = (large = false) => (
    <button
      className={`calm-orb spirit-orb webgl-orb ${orbState} ${large ? "large" : ""}`}
      onClick={toggleVoiceMode}
      aria-label="Talk to Korben"
    >
      <SpiritOrb
        state={orbState}
        tone={getAmbientState(ambientClock).current.key}
      />
    </button>
  );

  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");

  const toggleTheme = () => {
    const root = document.documentElement;
    const current = root.dataset.theme;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = current === "dark" ? "light" : current === "light" ? "dark" : systemDark ? "light" : "dark";
    root.dataset.theme = next;
    window.localStorage.setItem("korben:theme", next);
  };

  const renderCommandCenter = () => {
    const pendingApprovalCount = approvals.filter((approval) => approval.status === "pending").length;
    const homeStatus = pendingApprovalCount
      ? `${pendingApprovalCount} approval${pendingApprovalCount === 1 ? "" : "s"} waiting`
      : currentTask?.status === "in_progress"
        ? `${currentAgent?.name || "Korben"} is working quietly`
        : "Everything is quiet";

    const homeDelegationItems = [...tasks]
      .sort((a, b) => {
        const priority = (status: string) =>
          status === "in_progress" ? 0 :
          status === "awaiting_approval" ? 1 :
          status === "failed" ? 2 :
          status === "queued" ? 3 : 4;
        return priority(a.status) - priority(b.status) || a.sequence - b.sequence;
      })
      .slice(0, 4);

    return (
      <section className="korben-home">
        <header className="korben-home-nav">
          <button className="korben-home-wordmark" onClick={() => setActiveView("command")}>KORBEN</button>

          <nav className="korben-home-links" aria-label="Primary navigation">
            <button className="active" onClick={() => setActiveView("command")}>Home</button>
            <button onClick={() => setActiveView("work")}>Tasks</button>
            <button onClick={() => setActiveView("workstream")}>Delegation</button>
            <button onClick={() => setActiveView("command")}>Calendar</button>
            <button onClick={() => setActiveView("command")}>Communications</button>
            <button onClick={() => setActiveView("focus")}>Focus</button>
            <button onClick={() => setActiveView("brain")}>Library</button>
          </nav>

          <div className="korben-home-account">
            <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle light and dark mode">☼</button>
            <span className="presence-dot" />
            <button className="account-trigger" onClick={signOut} title="Sign out">Good {ambientClock.getHours() < 12 ? "morning" : ambientClock.getHours() < 18 ? "afternoon" : "evening"}, Jordan <span>⌄</span></button>
          </div>
        </header>

        <main className="korben-home-stage korben-home-stage-split">
          <div className="korben-home-copy">
            <h1>{getGreetingForHour(ambientClock.getHours())}, Jordan.</h1>
            <p>A CALMER, BRIGHTER YOU.</p>
          </div>

          <div className="korben-presence-center">
            <button
              className={`zen-listener ${orbState} ${voiceMode ? "active" : ""}`}
              onClick={toggleVoiceMode}
              aria-label="Talk to Korben"
            >
              <span className="zen-ring zen-ring-outer">
                <span className="zen-node zen-node-left" />
                <span className="zen-node zen-node-right" />
              </span>
              <span className="zen-ring zen-ring-inner" />
              <span className="zen-core">
                <span className="zen-core-glow" />
              </span>
            </button>

            <div className="korben-home-listening">
              <strong>{voiceState === "listening" ? "Listening" : voiceState === "thinking" ? "Thinking" : voiceState === "speaking" ? "Speaking" : "Listening"}</strong>
              <span>{voiceMode ? "Just speak to Korben." : "Tap Korben and speak."}</span>
            </div>

            <button className="quiet-status" onClick={() => setActiveView(pendingApprovalCount ? "work" : "runs")}>
              <i className={pendingApprovalCount ? "attention" : ""} />
              {homeStatus}
            </button>
          </div>

          <aside className="korben-home-sidecar" aria-label="Korben conversation and delegation">
            {latestUserMessage && (
              <div className="korben-live-transcript" aria-live="polite">
                <div className="transcript-line user">
                  <span>You</span>
                  <p>{latestUserMessage.text}</p>
                </div>
                {latestAssistantMessage && (
                  <div className="transcript-line assistant">
                    <span>Korben</span>
                    <p>{latestAssistantMessage.text}</p>
                  </div>
                )}
              </div>
            )}

            {homeDelegationItems.length > 0 && (
              <section className="home-delegation-feed" aria-label="Delegation activity">
                <div className="home-delegation-header">
                  <div>
                    <span>DELEGATION</span>
                    <strong>{activeObjective}</strong>
                  </div>
                  <button onClick={() => setActiveView("workstream")}>View all</button>
                </div>

                <div className="home-delegation-list">
                  {homeDelegationItems.map((task) => {
                    const agent = agentById(task.assigned_agent_id);
                    const taskEvent = runEvents.find((event) => event.task_id === task.id);
                    const statusText =
                      task.status === "in_progress" ? "Working" :
                      task.status === "awaiting_approval" ? "Waiting on you" :
                      task.status === "complete" ? "Complete" :
                      task.status === "failed" ? "Needs attention" :
                      "Queued";

                    return (
                      <button
                        key={task.id}
                        className={`home-delegation-row ${task.status}`}
                        onClick={() => setActiveView("workstream")}
                      >
                        <span className="home-agent-avatar">
                          {agent ? agent.name.slice(0, 2).toUpperCase() : "AI"}
                        </span>
                        <span className="home-delegation-copy">
                          <span>
                            <strong>{agent?.name || "Korben agent"}</strong>
                            <small>{statusText}</small>
                          </span>
                          <p>{task.status === "complete"
                            ? task.result_summary || taskEvent?.message || task.title
                            : taskEvent?.message || task.title}
                          </p>
                        </span>
                        <i className={task.status} />
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </aside>
        </main>

        <div className="korben-home-corner corner-left">
          <span className="corner-sun">☼</span>
          <div>
            <strong>{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(ambientClock)}</strong>
            <small>A BRIGHTER DAY AHEAD</small>
          </div>
        </div>

        <div className="korben-home-corner corner-right">
          <span>Cape Coral</span>
          <i />
          <span>{ambientClock.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        </div>
      </section>
    );
  };

  const renderCalmMode = () => (
    <section className="ambient-calm-mode">
      <AmbientScene className="ambient-scene-calm" />

      <div className="calm-brand">
        <strong>KORBEN</strong>
        <span>THINK AHEAD</span>
      </div>

      <button className="calm-exit" onClick={() => setCalmMode(false)}>Command Center</button>

      <div className="calm-mode-center">
        {renderOrb(true)}
        <div className="calm-mode-copy">
          <strong>{voiceState === "listening" ? "Listening" : compactStatus}</strong>
          <span className="calm-divider" />
          <small>{currentTask?.title || "I’ve handled everything for now."}</small>
        </div>
      </div>

      <div className="calm-quote">“A calmer mind builds a brighter you.”</div>

      <button
        className="calm-voice-trigger"
        onClick={toggleVoiceMode}
        aria-label="Talk to Korben"
      >
        {voiceMode ? "Listening for you" : "Talk to Korben"}
      </button>
    </section>
  );

  const renderNetwork = () => (
    <section className="os-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">LIVE TOPOLOGY</span>
          <h1>Agent Network</h1>
          <p>Departments, agents, status and current routing from the live Korben workspace.</p>
        </div>
        <div className="metric-strip">
          <div><strong>{departments.length}</strong><span>Departments</span></div>
          <div><strong>{agents.length}</strong><span>Agents</span></div>
          <div><strong>{tasks.filter((task) => task.status === "in_progress").length}</strong><span>Working</span></div>
        </div>
      </div>

      <div className="network-orchestrator">
        <div className="network-core">K</div>
        <div>
          <span>ORCHESTRATOR</span>
          <strong>Korben</strong>
          <p>Receives intent, selects departments, routes tasks and coordinates approvals.</p>
        </div>
      </div>

      <div className="department-grid">
        {departments.map((department) => {
          const departmentAgents = agents.filter((agent) => agent.department_id === department.id);
          return (
            <article className="department-card" key={department.id}>
              <div className="department-header">
                <div>
                  <span>DEPARTMENT</span>
                  <h2>{department.name}</h2>
                </div>
                <b>{departmentAgents.length} agents</b>
              </div>
              <div className="network-agent-list">
                {departmentAgents.map((agent) => {
                  const assignedTask = tasks.find((task) => task.assigned_agent_id === agent.id);
                  return (
                    <div className="network-agent" key={agent.id}>
                      <div className="agent-node">{agent.name.slice(0, 2).toUpperCase()}</div>
                      <div className="agent-detail">
                        <div><strong>{agent.name}</strong><span>{agent.role}</span></div>
                        <small>
                          {assignedTask
                            ? assignedTask.title
                            : `${agentToolPermissions.filter((permission) => permission.agent_id === agent.id).length} tools available`}
                        </small>
                      </div>
                      <span className={`agent-state ${agent.status}`}>{agent.status}</span>
                    </div>
                  );
                })}
                {!departmentAgents.length && <div className="empty-state">No agents in this department yet.</div>}
              </div>
            </article>
          );
        })}
        {!departments.length && <div className="empty-state large">No department records are available yet.</div>}
      </div>
    </section>
  );

  const renderWork = () => (
    <section className="os-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">ROUTING LEDGER</span>
          <h1>Work Routing</h1>
          <p>See what Korben has routed, who owns it, and where each task sits in the workflow.</p>
        </div>
        <div className="metric-strip">
          <div><strong>{tasks.length}</strong><span>Current tasks</span></div>
          <div><strong>{tasks.filter((task) => task.status === "queued").length}</strong><span>Queued</span></div>
          <div><strong>{tasks.filter((task) => task.status === "complete").length}</strong><span>Complete</span></div>
        </div>
      </div>

      {approvals.some((approval) => approval.status === "pending") && (
        <section className="approval-panel">
          <div className="approval-panel-header">
            <div>
              <span className="eyebrow">OWNER APPROVAL</span>
              <h2>Actions waiting for you</h2>
            </div>
            <b>{approvals.filter((approval) => approval.status === "pending").length}</b>
          </div>
          <div className="approval-list">
            {approvals
              .filter((approval) => approval.status === "pending")
              .map((approval) => (
                <article className="approval-card" key={approval.id}>
                  <div>
                    <span className="approval-risk">L{approval.risk_level}</span>
                    <strong>{approval.action_type}</strong>
                    <small>
                      {approval.risk_level === 3
                        ? "Production / destructive boundary"
                        : "Protected system change"}
                    </small>
                  </div>
                  <div className="approval-actions">
                    <button
                      className="approval-reject"
                      onClick={() => void rejectAction(approval)}
                    >
                      Reject
                    </button>
                    <button
                      className="approval-approve"
                      onClick={() => void approveAction(approval)}
                    >
                      Approve & resume
                    </button>
                  </div>
                </article>
              ))}
          </div>
        </section>
      )}

      <div className="work-board">
        {["queued", "in_progress", "awaiting_approval", "failed", "complete"].map((status) => (
          <div className={`work-lane work-lane-${status}`} key={status}>
            <div className="work-lane-header">
              <span>
                {status === "in_progress"
                  ? "IN PROGRESS"
                  : status === "awaiting_approval"
                    ? "WAITING ON YOU"
                    : status.toUpperCase()}
              </span>
              <b>{tasks.filter((task) => task.status === status).length}</b>
            </div>
            <div className="work-lane-body">
              {tasks.filter((task) => task.status === status).map((task) => {
                const owner = agentById(task.assigned_agent_id);
                const latestEvent = runEvents.find((event) => event.task_id === task.id);
                const statusCopy =
                  task.status === "in_progress"
                    ? latestEvent?.message || `${owner?.name || "Agent"} is working on this now.`
                    : task.status === "complete"
                      ? task.result_summary || latestEvent?.message || "Completed."
                      : task.status === "awaiting_approval"
                        ? "Korben is paused here until you approve the protected step."
                        : task.status === "failed"
                          ? task.result_summary || latestEvent?.message || "This task hit a blocker."
                          : "Queued and waiting for the prior step to finish.";

                return (
                  <article className={`task-card task-card-${task.status}`} key={task.id}>
                    <div className="task-card-topline">
                      <span className="task-sequence">#{task.sequence}</span>
                      <span className={`task-status-pill ${task.status}`}>
                        {task.status === "in_progress"
                          ? "Working"
                          : task.status === "awaiting_approval"
                            ? "Approval"
                            : task.status === "complete"
                              ? "Done"
                              : task.status === "failed"
                                ? "Blocked"
                                : "Queued"}
                      </span>
                    </div>
                    <strong>{task.title}</strong>
                    <p>{task.description || "No description"}</p>
                    <div className="task-live-update">
                      <small>LATEST UPDATE</small>
                      <span>{statusCopy}</span>
                    </div>
                    <div className="task-owner">
                      <span>{owner ? owner.name.slice(0, 2).toUpperCase() : "—"}</span>
                      <div>
                        <small>ROUTED TO</small>
                        <b>{owner ? owner.name : "Unassigned"}</b>
                      </div>
                    </div>
                    {(task.started_at || task.completed_at) && (
                      <div className="task-timing">
                        {task.started_at && <span>Started {new Date(task.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
                        {task.completed_at && <span>Finished {new Date(task.completed_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
                      </div>
                    )}
                  </article>
                );
              })}
              {!tasks.some((task) => task.status === status) && (
                <div className="lane-empty">Nothing here.</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  const renderWorkstream = () => {
    const sortedTasks = [...tasks].sort((a, b) => a.sequence - b.sequence);
    const latestEventsByTask = new Map<string, RunEvent>();

    [...runEvents]
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .forEach((event) => {
        if (event.task_id && !latestEventsByTask.has(event.task_id)) {
          latestEventsByTask.set(event.task_id, event);
        }
      });

    const completed = sortedTasks.filter((task) => task.status === "complete").length;
    const working = sortedTasks.filter((task) => task.status === "in_progress").length;
    const waiting = sortedTasks.filter((task) => task.status === "awaiting_approval").length;

    return (
      <section className="os-view delegation-view">
        <div className="view-heading delegation-heading">
          <div>
            <span className="eyebrow">KORBEN WORKSTREAM</span>
            <h1>Delegation</h1>
            <p>See what Korben handed off, who is working on it, and what came back.</p>
          </div>
          <div className="delegation-summary">
            <span><i className="queued" />{sortedTasks.length - completed - working - waiting} queued</span>
            <span><i className="working" />{working} working</span>
            <span><i className="complete" />{completed} complete</span>
          </div>
        </div>

        <div className="delegation-thread">
          <article className="delegation-message korben-message">
            <div className="delegation-avatar korben-avatar">K</div>
            <div className="delegation-bubble">
              <div className="delegation-meta">
                <strong>Korben</strong>
                <span>Coordinator</span>
              </div>
              <p>
                {sortedTasks.length
                  ? `I broke “${activeObjective}” into ${sortedTasks.length} delegated step${sortedTasks.length === 1 ? "" : "s"}. I’ll keep this feed updated as the agents work.`
                  : "Nothing is delegated right now. Give me a task and I’ll show the handoffs here."}
              </p>
            </div>
          </article>

          {sortedTasks.map((task) => {
            const agent = agentById(task.assigned_agent_id);
            const event = latestEventsByTask.get(task.id);
            const stateLabel =
              task.status === "in_progress"
                ? "Working now"
                : task.status === "complete"
                  ? "Completed"
                  : task.status === "awaiting_approval"
                    ? "Waiting for you"
                    : task.status === "failed"
                      ? "Needs attention"
                      : "Queued";

            return (
              <div className="delegation-step" key={task.id}>
                <article className="delegation-message handoff-message">
                  <div className="delegation-avatar korben-avatar">K</div>
                  <div className="delegation-bubble">
                    <div className="delegation-meta">
                      <strong>Korben</strong>
                      <span>Delegated to {agent?.name || "an agent"}</span>
                    </div>
                    <p>{task.title}</p>
                    {task.description && <small>{task.description}</small>}
                  </div>
                </article>

                <article className={`delegation-message agent-message ${task.status}`}>
                  <div className="delegation-avatar agent-avatar">
                    {agent ? agent.name.slice(0, 2).toUpperCase() : "AI"}
                  </div>
                  <div className="delegation-bubble">
                    <div className="delegation-meta">
                      <strong>{agent?.name || "Korben agent"}</strong>
                      <span>{agent?.role || "Specialist"}</span>
                      <b className={`delegation-state ${task.status}`}>{stateLabel}</b>
                    </div>

                    {task.status === "complete" ? (
                      <>
                        <p>{task.result_summary || event?.message || "Completed and reported back to Korben."}</p>
                        <small>Korben has received this result.</small>
                      </>
                    ) : task.status === "in_progress" ? (
                      <>
                        <p>{event?.message || `Working on ${task.title.toLowerCase()}.`}</p>
                        <small>Live status · updates automatically</small>
                      </>
                    ) : task.status === "awaiting_approval" ? (
                      <>
                        <p>I’m paused here until you approve the protected action.</p>
                        <button className="delegation-review-button" onClick={() => setActiveView("work")}>Review approval</button>
                      </>
                    ) : task.status === "failed" ? (
                      <>
                        <p>{task.result_summary || event?.message || "I hit a blocker and could not finish this step."}</p>
                        <small>Open Runs for technical details.</small>
                      </>
                    ) : (
                      <>
                        <p>Waiting for the prior step to finish.</p>
                        <small>Queued by Korben</small>
                      </>
                    )}
                  </div>
                </article>
              </div>
            );
          })}

          {sortedTasks.length > 0 && completed === sortedTasks.length && (
            <article className="delegation-message korben-message final-report">
              <div className="delegation-avatar korben-avatar">K</div>
              <div className="delegation-bubble">
                <div className="delegation-meta">
                  <strong>Korben</strong>
                  <span>Report back</span>
                </div>
                <p>Done. All {completed} delegated steps are complete. The work is finished.</p>
              </div>
            </article>
          )}
        </div>
      </section>
    );
  };

  const renderRuns = () => (
    <section className="os-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">EXECUTION TRACE</span>
          <h1>Runs & Activity</h1>
          <p>Auditable agent and tool activity for the selected project.</p>
        </div>
        <div className="metric-strip">
          <div><strong>{runEvents.length}</strong><span>Recent events</span></div>
          <div><strong>{runEvents.filter((event) => event.status === "error").length}</strong><span>Errors</span></div>
          <div><strong>{runEvents.filter((event) => event.status === "waiting_approval").length}</strong><span>Approvals</span></div>
        </div>
      </div>

      <div className="run-event-list">
        {runEvents.map((event) => {
          const agent = agentById(event.agent_id);
          return (
            <article className="run-event-card" key={event.id}>
              <span className={`run-event-dot ${event.status}`} />
              <div className="run-event-main">
                <div>
                  <strong>{agent?.name || "Korben system"}</strong>
                  <span>{event.event_type.replaceAll("_", " ")}</span>
                  {event.tool_system_key && <b>{event.tool_system_key}</b>}
                </div>
                <p>{event.message || "No event detail"}</p>
              </div>
              <time>{new Date(event.created_at).toLocaleString()}</time>
            </article>
          );
        })}
        {!runEvents.length && (
          <div className="empty-state large">No agent runs have been recorded for this project yet.</div>
        )}
      </div>
    </section>
  );

  const renderFocus = () => (
    <section className="os-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">ACCOUNTABILITY ORGAN</span>
          <h1>Focus</h1>
          <p>A privacy-safe focus session inspired by JARVIS: timer, goal, optional tab lock, interruption tracking and a report card.</p>
        </div>
        <div className="metric-strip">
          <div><strong>{focusStreak}</strong><span>Streak</span></div>
          <div><strong>{focusInterruptions}</strong><span>Drifts</span></div>
          <div><strong>{focusRunning ? "LIVE" : "OFF"}</strong><span>State</span></div>
        </div>
      </div>

      <div className="focus-layout">
        <article className="focus-console">
          <span className="eyebrow">SESSION TIMER</span>
          <div className={`focus-clock ${focusRunning && !focusPaused ? "running" : ""}`}>
            {focusRunning || focusRemaining ? focusClock : `${String(focusMinutes).padStart(2, "0")}:00`}
          </div>
          <input
            className="focus-goal-input"
            value={focusGoal}
            onChange={(event) => setFocusGoal(event.target.value)}
            placeholder="What are we focusing on?"
            disabled={focusRunning}
          />
          <div className="focus-duration-row">
            {[15, 25, 30, 45, 60].map((minutes) => (
              <button
                key={minutes}
                className={focusMinutes === minutes ? "active" : ""}
                onClick={() => setFocusMinutes(minutes)}
                disabled={focusRunning}
              >
                {minutes}m
              </button>
            ))}
          </div>
          <div className="focus-actions">
            {!focusRunning ? (
              <button className="focus-start" onClick={startFocus}>Start focus</button>
            ) : (
              <>
                <button onClick={() => setFocusPaused((paused) => !paused)}>
                  {focusPaused ? "Resume" : "Pause"}
                </button>
                <button
                  className={focusLockTab ? "active" : ""}
                  onClick={() => setFocusLockTab((locked) => !locked)}
                >
                  {focusLockTab ? "Tab locked" : "Lock this tab"}
                </button>
                <button className="focus-stop" onClick={endFocus}>End session</button>
              </>
            )}
          </div>
        </article>

        <aside className="focus-side">
          <article className="focus-card">
            <span className="eyebrow">PRIVACY BOUNDARY</span>
            <strong>Nothing is watching your camera or screen.</strong>
            <p>The optional tab lock uses only the browser visibility signal. Korben knows only that you left this tab—not what you opened.</p>
          </article>
          <article className="focus-card">
            <span className="eyebrow">REPORT CARD</span>
            <strong>{focusReport ? "Latest session" : "No completed session yet"}</strong>
            <p>{focusReport || "Finish a session and Korben will summarize duration, goal and detected tab drift."}</p>
          </article>
        </aside>
      </div>
    </section>
  );

  const renderPreflight = () => (
    <section className="os-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">SYSTEM PREFLIGHT</span>
          <h1>Preflight</h1>
          <p>JARVIS-style health check for the active Korben execution environment before you trust it with autonomous work.</p>
        </div>
        <button className="preflight-run" onClick={() => void runPreflight()} disabled={preflightBusy}>
          {preflightBusy ? "Checking…" : "Run preflight"}
        </button>
      </div>

      <div className={`preflight-summary ${preflightReport?.overall || "idle"}`}>
        <div>
          <span className="eyebrow">SYSTEM VERDICT</span>
          <strong>
            {preflightReport
              ? preflightReport.overall === "healthy"
                ? "All core systems healthy"
                : preflightReport.overall === "degraded"
                  ? "Operational with warnings"
                  : "Attention required"
              : "Preflight has not been run"}
          </strong>
        </div>
        <small>
          {preflightReport
            ? `${preflightReport.project.name} · checked ${new Date(preflightReport.checked_at).toLocaleString()}`
            : "Run the check to verify credentials, agents, tools, Brain, approvals and recent run health."}
        </small>
      </div>

      <div className="preflight-grid">
        {(preflightReport?.checks || []).map((check) => (
          <article className={`preflight-card ${check.status}`} key={check.key}>
            <span className="preflight-dot" />
            <div>
              <strong>{check.label}</strong>
              <span>{check.status.replaceAll("_", " ")}</span>
              <p>{check.detail}</p>
            </div>
          </article>
        ))}
        {!preflightReport && (
          <div className="empty-state large">No health snapshot yet.</div>
        )}
      </div>
    </section>
  );

  const renderBrainGalaxy = () => {
    const galaxyEntries = knowledgeEntries.slice(0, 24);
    const centerX = 50;
    const centerY = 47;

    return (
      <section className="os-view brain-galaxy-view">
        <div className="view-heading">
          <div>
            <span className="eyebrow">LIVING KNOWLEDGE GRAPH</span>
            <h1>Brain Galaxy</h1>
            <p>Korben’s shared Brain rendered as an active constellation of SOPs, facts, decisions, memories and project knowledge.</p>
          </div>
          <div className="metric-strip">
            <div><strong>{knowledgeEntries.length}</strong><span>Entries</span></div>
            <div><strong>{knowledgeSources.length}</strong><span>Sources</span></div>
            <div><strong>{agents.length}</strong><span>Readers</span></div>
          </div>
        </div>

        <div className="brain-galaxy">
          <div className="galaxy-grid" />
          <div className="galaxy-haze haze-a" />
          <div className="galaxy-haze haze-b" />
          <svg className="galaxy-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {galaxyEntries.map((entry, index) => {
              const angle = (index / Math.max(galaxyEntries.length, 1)) * Math.PI * 2;
              const radius = 20 + (index % 4) * 6;
              const x = centerX + Math.cos(angle) * radius;
              const y = centerY + Math.sin(angle) * radius * .72;
              return (
                <line
                  key={entry.id}
                  x1={centerX}
                  y1={centerY}
                  x2={x}
                  y2={y}
                  className={`galaxy-link ${entry.entry_type}`}
                />
              );
            })}
          </svg>

          <button className="galaxy-core" onClick={() => setActiveView("command")}>
            <span>K</span>
            <strong>KORBEN BRAIN</strong>
            <small>{knowledgeEntries.length} active entries</small>
          </button>

          {galaxyEntries.map((entry, index) => {
            const angle = (index / Math.max(galaxyEntries.length, 1)) * Math.PI * 2;
            const radius = 20 + (index % 4) * 6;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius * .72;

            return (
              <article
                key={entry.id}
                className={`galaxy-node ${entry.entry_type}`}
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  "--delay": `${index * -.17}s`,
                } as React.CSSProperties}
                title={entry.title}
              >
                <span className="galaxy-node-dot" />
                <div className="galaxy-node-card">
                  <small>{entry.entry_type.toUpperCase()}</small>
                  <strong>{entry.title}</strong>
                  <p>{entry.content.length > 120 ? `${entry.content.slice(0, 120)}…` : entry.content}</p>
                </div>
              </article>
            );
          })}

          <div className="galaxy-legend">
            {["sop", "fact", "decision", "memory", "document"].map((type) => (
              <span key={type} className={type}><i />{type}</span>
            ))}
          </div>
        </div>
      </section>
    );
  };

  const renderKnowledgeView = () => {
    const content = {
      brain: {
        eyebrow: "KNOWLEDGE LAYER",
        title: "Brain & Memory",
        description: "Live shared knowledge sources and governed memory available to every Korben agent.",
        cards: [
          ...knowledgeSources.map((source) => [
            source.name,
            source.status.replaceAll("_", " "),
            `${source.provider} · ${source.connection_type}${source.last_sync_at ? ` · synced ${new Date(source.last_sync_at).toLocaleString()}` : ""}${source.last_error ? ` · ${source.last_error}` : ""}`
          ]),
          [
            "Shared knowledge",
            `${knowledgeEntries.length} entries`,
            `${knowledgeEntries.filter((entry) => entry.entry_type === "memory").length} memories · ${knowledgeEntries.filter((entry) => entry.entry_type === "fact").length} facts · ${knowledgeEntries.filter((entry) => entry.entry_type === "decision").length} decisions`
          ]
        ]
      },
      sops: {
        eyebrow: "OPERATING KNOWLEDGE",
        title: "SOP Library",
        description: "Live procedures retrieved by agents before they act.",
        cards: knowledgeEntries
          .filter((entry) => entry.entry_type === "sop")
          .map((entry) => [
            entry.title,
            entry.status,
            entry.content.length > 260 ? `${entry.content.slice(0, 260)}…` : entry.content
          ])
      },
      tools: {
        eyebrow: "CAPABILITY REGISTRY",
        title: "Tool Registry",
        description: "Live governed capabilities from Korben’s tool registry.",
        cards: tools.map((tool) => [
          tool.name,
          tool.status === "available" ? `L${tool.risk_level} available` : tool.status,
          `${tool.provider} · ${tool.system_key} · ${tool.description || "No description"}`
        ])
      },
      integrations: {
        eyebrow: "SYSTEM CONNECTIONS",
        title: "Integrations",
        description: "Live runtime credential and adapter health for Korben.",
        cards: [
          ["Supabase", integrationStatus?.supabase ? "Connected" : "Not configured", "Primary application data and authentication."],
          ["OpenAI", integrationStatus?.openai ? "Connected" : "Not configured", "Intent routing and specialist agent reasoning."],
          ["GitHub", integrationStatus?.github ? "Connected" : "Needs credential", "Server-side repository execution gateway."],
          ["Vercel", integrationStatus?.vercel ? "Connected" : "Needs credential", "Server-side deployment inspection gateway."],
          ["G-Brain", integrationStatus?.gbrain ? "Connected" : "Not configured", "Shared semantic knowledge retrieval."],
          ["Obsidian", integrationStatus?.obsidian ? "Connected" : "Not configured", "Human-editable knowledge vault bridge."]
        ]
      }
    }[activeView as "brain" | "sops" | "tools" | "integrations"];

    return (
      <section className="os-view">
        <div className="view-heading">
          <div>
            <span className="eyebrow">{content.eyebrow}</span>
            <h1>{content.title}</h1>
            <p>{content.description}</p>
          </div>
        </div>
        <div className="registry-grid">
          {content.cards.map(([name, status, description]) => (
            <article className="registry-card" key={name}>
              <div className="registry-card-top">
                <strong>{name}</strong>
                <span className={`registry-status ${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>
              </div>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
    );
  };

  if (calmMode) {
    return renderCalmMode();
  }

  if (activeView === "command") {
    return <main className="command-home-shell">{renderCommandCenter()}</main>;
  }

  return (
    <main className="zen-app-page">
      <header className="korben-home-nav zen-app-nav">
        <button className="korben-home-wordmark" onClick={() => setActiveView("command")}>KORBEN</button>

        <nav className="korben-home-links zen-app-links" aria-label="Primary navigation">
          <button onClick={() => setActiveView("command")}>Home</button>
          <button className={activeView === "work" ? "active" : ""} onClick={() => setActiveView("work")}>Tasks</button>
          <button className={activeView === "workstream" ? "active" : ""} onClick={() => setActiveView("workstream")}>Delegation</button>
          <button className={activeView === "network" ? "active" : ""} onClick={() => setActiveView("network")}>Agents</button>
          <button className={activeView === "focus" ? "active" : ""} onClick={() => setActiveView("focus")}>Focus</button>
          <button className={["brain","sops","tools","integrations"].includes(activeView) ? "active" : ""} onClick={() => setActiveView("brain")}>Library</button>
        </nav>

        <div className="korben-home-account">
          <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle light and dark mode">☼</button>
          <span className="presence-dot" />
          <button className="account-trigger" onClick={signOut} title="Sign out">
            Good {ambientClock.getHours() < 12 ? "morning" : ambientClock.getHours() < 18 ? "afternoon" : "evening"}, Jordan <span>⌄</span>
          </button>
        </div>
      </header>

      <section className="zen-page-wrap">
        <div className="zen-page-kicker">
          <button onClick={() => setActiveView("command")}>← Home</button>
          <span>{currentProjectName}</span>
          <i />
          <strong>{viewTitle}</strong>
        </div>

        {activeView === "network" && renderNetwork()}
        {activeView === "work" && renderWork()}
        {activeView === "workstream" && renderWorkstream()}
        {activeView === "runs" && renderRuns()}
        {activeView === "focus" && renderFocus()}
        {activeView === "preflight" && renderPreflight()}
        {activeView === "brain" && renderBrainGalaxy()}
        {["sops", "tools", "integrations"].includes(activeView) && renderKnowledgeView()}
      </section>
    </main>
  );
}
