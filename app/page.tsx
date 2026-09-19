"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserSupabaseClient } from "../lib/supabase/client";

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
};

const normalizeKorbenName = (value: string) =>
  value.replace(/\bcorbin\b/gi, (match) =>
    match[0] === match[0]?.toUpperCase() ? "Korben" : "korben"
  );

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
  const [activeView, setActiveView] = useState<"command" | "network" | "work" | "brain" | "sops" | "tools" | "integrations">("command");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [tools, setTools] = useState<ToolRecord[]>([]);
  const [agentToolPermissions, setAgentToolPermissions] = useState<AgentToolPermission[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeObjective, setActiveObjective] = useState<string>("No active objective");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loadingState, setLoadingState] = useState("Connecting…");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceState, setVoiceState] = useState<"waiting" | "listening" | "thinking" | "speaking">("waiting");
  const [conversationActive, setConversationActive] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");
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

      const { data: project } = await supabase
        .from("projects")
        .select("id,name")
        .eq("slug", "general-workspace")
        .single();

      if (!project) {
        setLoadingState("Project not found");
        return;
      }

      setProjectId(project.id);

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
        const { data: taskRows } = await supabase
          .from("tasks")
          .select("id,title,description,status,sequence,assigned_agent_id")
          .eq("objective_id", objective.id)
          .order("sequence");
        setTasks(taskRows || []);
      }

      setLoadingState("System online");
    };

    bootstrap();
  }, [supabase]);

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
        .eq("slug", "general-workspace")
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
          projectName: "General Workspace",
        }),
      });

      if (planResponse.ok) {
        plan = (await planResponse.json()) as OrchestrationPlan;
      }
    } catch (error) {
      console.error("Korben planning failed; using fallback plan.", error);
    }

    let objective: { id: string; title: string } | null = null;
    let createdTasks: Task[] = [];

    if (plan.tasks.length > 0 && !["conversation", "question"].includes(plan.intent)) {
      const { data: createdObjective } = await supabase
        .from("objectives")
        .insert({
          project_id: resolvedProjectId,
          conversation_id: resolvedConversationId,
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
        input: { request: text, input_mode: currentInputMode },
        output: plan,
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
        objective_id: objective?.id || null,
        event_type: "message_received",
        message: "New Command Center request received",
        metadata: {
          input_mode: currentInputMode,
          message_id: insertedMessage?.id || null,
        },
      },
      {
        project_id: resolvedProjectId,
        objective_id: objective?.id || null,
        event_type: "plan_generated",
        message: objective ? `Execution plan generated: ${objective.title}` : "Planning attempted",
        metadata: {
          task_count: createdTasks.length,
          intent: plan.intent,
          requires_execution: plan.requires_execution,
        },
      },
    ]);

    setInputMode("text");
    setLoadingState("System online");
    sendingRef.current = false;
    setSending(false);

    if (voiceModeRef.current && "speechSynthesis" in window) {
      setVoiceState("speaking");
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(reply);
      utterance.rate = 0.96;
      utterance.pitch = 0.9;

      const voices = window.speechSynthesis.getVoices();
      const preferredVoice =
        voices.find((voice) => /Google UK English Male/i.test(voice.name)) ||
        voices.find((voice) => /Microsoft.*(Guy|Ryan|Mark|David)/i.test(voice.name)) ||
        voices.find((voice) => /male/i.test(voice.name)) ||
        voices.find((voice) => voice.lang.startsWith("en"));

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

  const completedTasks = tasks.filter((task) => task.status === "complete").length;
  const progress = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0;

  if (!authReady) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <div className="brand auth-brand">
            <div className="brand-mark">K</div>
            <div>
              <strong>KORBEN</strong>
              <span>Multi-Agent OS</span>
            </div>
          </div>
          <p className="auth-status">Connecting to your workspace…</p>
        </div>
      </main>
    );
  }

  if (!signedIn) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <div className="brand auth-brand">
            <div className="brand-mark">K</div>
            <div>
              <strong>KORBEN</strong>
              <span>Multi-Agent OS</span>
            </div>
          </div>
          <div className="auth-copy">
            <span className="kicker">OWNER ACCESS</span>
            <h1>Sign in to Korben</h1>
            <p>Your Command Center, agents, projects and run history are protected by your Korben account.</p>
          </div>
          <div className="auth-form">
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
            <button className="auth-submit" onClick={signIn} disabled={loginBusy}>
              {loginBusy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </div>
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
    activeView === "brain" ? "Brain & Memory" :
    activeView === "sops" ? "SOP Library" :
    activeView === "tools" ? "Tool Registry" :
    "Integrations";

  const renderCommandCenter = () => (
    <section className="korben-stage">
      <div className="ambient-grid" />

      <div className="core-column">
        <div
          className={`korben-core ${voiceState} ${voiceMode ? "armed" : ""}`}
          onClick={toggleVoiceMode}
          role="button"
          tabIndex={0}
          aria-label="Korben voice core"
        >
          <div className="core-orbit orbit-one" />
          <div className="core-orbit orbit-two" />
          <div className="core-orbit orbit-three" />
          <div className="core-energy" />
          <div className="core-center"><span>K</span></div>
          <div className="voice-ripple ripple-one" />
          <div className="voice-ripple ripple-two" />
          <div className="voice-ripple ripple-three" />
        </div>

        <div className="core-status">
          <span className={`status-light ${voiceState}`} />
          <strong>{statusCopy}</strong>
          <p>
            {voiceState === "listening"
              ? input || "I’m listening."
              : voiceState === "thinking"
                ? "Processing your request."
                : voiceState === "speaking"
                  ? "Korben is responding."
                  : voiceMode
                    ? conversationActive
                      ? "Conversation is open. Speak naturally."
                      : "Wake me by saying “Korben”."
                    : "Activate voice or type below."}
          </p>
        </div>

        <div className="voice-actions">
          <button
            className={`voice-primary ${voiceMode ? "active" : ""}`}
            onClick={toggleVoiceMode}
            disabled={!speechSupported}
          >
            <span className="voice-primary-dot" />
            {voiceMode ? "Voice online" : "Activate voice"}
          </button>
        </div>

        <div className="command-input">
          <input
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setInputMode("text");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void sendMessage();
              }
            }}
            placeholder="Type a message to Korben…"
          />
          <button onClick={() => void sendMessage()} disabled={!input.trim() || sending}>
            {sending ? "…" : "↗"}
          </button>
        </div>

        {!speechSupported && (
          <div className="voice-warning">Voice recognition is unavailable in this browser.</div>
        )}
      </div>

      <aside className="conversation-rail">
        <div className="rail-header">
          <div>
            <span>CONVERSATION</span>
            <strong>Command log</strong>
          </div>
          <span className="rail-live">● LIVE</span>
        </div>

        <div className="rail-messages">
          {messages.map((message, index) => (
            <div key={message.id || index} className={`rail-message ${message.role}`}>
              <div className="rail-message-meta">
                <span>{message.role === "user" ? "YOU" : "KORBEN"}</span>
                <small>{message.inputMode === "voice" ? "VOICE" : "TEXT"}</small>
              </div>
              <p>{message.text}</p>
            </div>
          ))}

          {sending && (
            <div className="rail-message assistant pending">
              <div className="rail-message-meta">
                <span>KORBEN</span>
                <small>PROCESSING</small>
              </div>
              <p>Thinking…</p>
            </div>
          )}
        </div>

        <div className="rail-footer">
          <div>
            <span className="footer-label">SYSTEM</span>
            <strong>{loadingState}</strong>
          </div>
          <div>
            <span className="footer-label">ACTIVE OBJECTIVE</span>
            <strong>{activeObjective}</strong>
          </div>
          <div>
            <span className="footer-label">TASKS</span>
            <strong>{tasks.length}</strong>
          </div>
        </div>
      </aside>
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

      <div className="work-board">
        {["queued", "in_progress", "complete"].map((status) => (
          <div className="work-lane" key={status}>
            <div className="work-lane-header">
              <span>{status === "in_progress" ? "IN PROGRESS" : status.toUpperCase()}</span>
              <b>{tasks.filter((task) => task.status === status).length}</b>
            </div>
            <div className="work-lane-body">
              {tasks.filter((task) => task.status === status).map((task) => {
                const owner = agentById(task.assigned_agent_id);
                return (
                  <article className="task-card" key={task.id}>
                    <span className="task-sequence">#{task.sequence}</span>
                    <strong>{task.title}</strong>
                    <p>{task.description || "No description"}</p>
                    <div className="task-owner">
                      <span>{owner ? owner.name.slice(0, 2).toUpperCase() : "—"}</span>
                      <div>
                        <small>ROUTED TO</small>
                        <b>{owner ? owner.name : "Unassigned"}</b>
                      </div>
                    </div>
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

  const renderKnowledgeView = () => {
    const content = {
      brain: {
        eyebrow: "KNOWLEDGE LAYER",
        title: "Brain & Memory",
        description: "Korben’s long-term knowledge layer. G-Brain and Obsidian will feed the same governed memory surface.",
        cards: [
          ["G-Brain", "Not configured", "Semantic search and durable Markdown knowledge store."],
          ["Obsidian Vault", "Not configured", "Human-editable notes, SOPs, decisions and source documents."],
          ["Conversation Memory", "Live", "Supabase-backed Korben conversation history."],
          ["Workspace Context", "Live", "Organization, project, objective and task context."]
        ]
      },
      sops: {
        eyebrow: "OPERATING KNOWLEDGE",
        title: "SOP Library",
        description: "Procedures Korben and its agents can retrieve before acting.",
        cards: [
          ["Global SOPs", "Structure ready", "Cross-business operating procedures."],
          ["Department SOPs", "Structure ready", "Procedures scoped to each agent department."],
          ["Project Playbooks", "Structure ready", "Project-specific standards and constraints."],
          ["Approval Policies", "Live foundation", "Risk levels already exist in Korben’s work model."]
        ]
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
        description: "Connection health and external systems available to the Korben runtime.",
        cards: [
          ["Supabase", "Connected", "Primary application data and authentication."],
          ["OpenAI", "Configured", "Korben orchestration endpoint."],
          ["GitHub", "Not wired into runtime", "Connector exists outside the app; runtime execution is next."],
          ["Vercel", "Not wired into runtime", "Production host is active; agent deployment control is next."],
          ["G-Brain", "Not configured", "Requires a companion service or accessible G-Brain endpoint."],
          ["Obsidian", "Not configured", "Requires vault access through a local bridge or synced source."]
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

  return (
    <main className="os-shell">
      <aside className="os-sidebar">
        <button className="sidebar-brand" onClick={() => setActiveView("command")}>
          <span className="mini-core">K</span>
          <div><strong>KORBEN</strong><small>OPERATING SYSTEM</small></div>
        </button>

        <nav className="os-nav">
          <span className="nav-section">CORE</span>
          <button className={activeView === "command" ? "active" : ""} onClick={() => setActiveView("command")}><i>◉</i><span>Command</span></button>
          <button className={activeView === "network" ? "active" : ""} onClick={() => setActiveView("network")}><i>⌘</i><span>Agent Network</span><b>{agents.length}</b></button>
          <button className={activeView === "work" ? "active" : ""} onClick={() => setActiveView("work")}><i>↗</i><span>Work Routing</span><b>{tasks.length}</b></button>

          <span className="nav-section">KNOWLEDGE</span>
          <button className={activeView === "brain" ? "active" : ""} onClick={() => setActiveView("brain")}><i>◇</i><span>Brain</span></button>
          <button className={activeView === "sops" ? "active" : ""} onClick={() => setActiveView("sops")}><i>▤</i><span>SOPs</span></button>

          <span className="nav-section">SYSTEM</span>
          <button className={activeView === "tools" ? "active" : ""} onClick={() => setActiveView("tools")}><i>⌁</i><span>Tools</span></button>
          <button className={activeView === "integrations" ? "active" : ""} onClick={() => setActiveView("integrations")}><i>⬡</i><span>Integrations</span></button>
        </nav>

        <div className="sidebar-system">
          <span className="system-pulse" />
          <div><strong>{loadingState}</strong><small>General Workspace</small></div>
        </div>
      </aside>

      <div className="os-main">
        <header className="korben-topbar">
          <div>
            <span className="topbar-kicker">KORBEN / {viewTitle.toUpperCase()}</span>
            <strong className="topbar-title">{viewTitle}</strong>
          </div>
          <div className="korben-top-actions">
            <span className="workspace-chip">General Workspace</span>
            <button className="avatar" onClick={signOut} title="Sign out">JG</button>
          </div>
        </header>

        {activeView === "command" && renderCommandCenter()}
        {activeView === "network" && renderNetwork()}
        {activeView === "work" && renderWork()}
        {["brain", "sops", "tools", "integrations"].includes(activeView) && renderKnowledgeView()}
      </div>
    </main>
  );
}
