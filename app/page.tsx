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
};

type PlannedTask = {
  title: string;
  description: string;
  agent_system_key: string;
  acceptance_criteria: string[];
  approval_level: number;
};

type OrchestrationPlan = {
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
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeObjective, setActiveObjective] = useState<string>("No active objective");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loadingState, setLoadingState] = useState("Connecting…");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");
  const recognitionRef = useRef<any>(null);
  const heldShortcutRef = useRef(false);
  const sendingRef = useRef(false);
  const voiceModeRef = useRef(false);
  const voiceSubmittedRef = useRef(false);
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

      const { data: dept } = await supabase
        .from("departments")
        .select("id")
        .eq("slug", "web-development")
        .single();

      if (dept) {
        const { data: agentRows } = await supabase
          .from("agents")
          .select("id,name,role,status,system_key")
          .eq("department_id", dept.id)
          .order("name");
        setAgents(agentRows || []);
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
        const { data: taskRows } = await supabase
          .from("tasks")
          .select("id,title,description,status,sequence")
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
    recognition.continuous = false;

    recognition.onstart = () => {
      voiceSubmittedRef.current = false;
      setListening(true);
      setInputMode("voice");
    };
    recognition.onend = () => {
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event: any) => {
      let transcript = "";
      let hasFinalResult = false;

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          hasFinalResult = true;
        }
      }

      const normalizedTranscript = normalizeKorbenName(transcript.trim());
      setInput(normalizedTranscript);

      if (
        hasFinalResult &&
        normalizedTranscript &&
        !voiceSubmittedRef.current &&
        !sendingRef.current
      ) {
        voiceSubmittedRef.current = true;
        void sendMessageRef.current(normalizedTranscript, "voice");
      }
    };

    recognitionRef.current = recognition;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.code === "Space" && !event.repeat) {
        event.preventDefault();
        heldShortcutRef.current = true;
        try {
          recognition.start();
        } catch {}
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" && heldShortcutRef.current) {
        event.preventDefault();
        heldShortcutRef.current = false;
        try {
          recognition.stop();
        } catch {}
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      try {
        recognition.stop();
      } catch {}
    };
  }, []);

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
    await supabase.auth.signOut();
    setSignedIn(false);
    setMessages([fallbackGreeting]);
    setTasks([]);
    setProjectId(null);
    setConversationId(null);
    setActiveObjective("No active objective");
    setLoadingState("Sign in required");
  };

  const toggleMic = () => {
    if (!speechSupported || !recognitionRef.current) return;
    if (listening) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
      } catch {}
    }
  };

  const toggleVoiceMode = () => {
    const next = !voiceMode;
    voiceModeRef.current = next;
    setVoiceMode(next);
    if (!next && listening) {
      try {
        recognitionRef.current?.stop();
      } catch {}
    }
    if (next && speechSupported && !listening) {
      try {
        recognitionRef.current?.start();
      } catch {}
    }
  };

  const fallbackPlan = (requestText: string): OrchestrationPlan => ({
    title: requestText.length > 72 ? `${requestText.slice(0, 69)}…` : requestText,
    summary: requestText,
    assistant_reply:
      "I saved the objective, but the AI planner is not available yet. I created a safe fallback development plan so the work is still structured.",
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

    const { data: objective } = await supabase
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

    let createdTasks: Task[] = [];

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
        .select("id,title,description,status,sequence")
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
        },
      },
    ]);

    setInputMode("text");
    setLoadingState("System online");
    sendingRef.current = false;
    setSending(false);

    if (voiceModeRef.current && speechSupported) {
      window.setTimeout(() => {
        try {
          recognitionRef.current?.start();
        } catch {}
      }, 350);
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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <strong>KORBEN</strong>
            <span>Multi-Agent OS</span>
          </div>
        </div>
        <nav className="nav">
          <button className="nav-item active"><span>⌘</span>Command Center</button>
          <button className="nav-item"><span>✓</span>Tasks <b>{tasks.length}</b></button>
          <button className="nav-item"><span>↻</span>Runs</button>
          <div className="nav-label">Workspace</div>
          <button className="nav-item"><span>▦</span>Departments</button>
          <button className="nav-item"><span>◇</span>Projects</button>
          <button className="nav-item"><span>◉</span>Agents</button>
          <button className="nav-item"><span>▤</span>Knowledge</button>
          <div className="nav-label">System</div>
          <button className="nav-item"><span>⌁</span>Integrations</button>
          <button className="nav-item"><span>⚙</span>Settings</button>
        </nav>
        <div className="sidebar-footer">
          <div className="system-dot" />
          <div>
            <strong>{loadingState}</strong>
            <span>KorbenOS workspace</span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Command Center</span>
            <h1>Good morning, Jordan.</h1>
          </div>
          <div className="top-actions">
            <div className="project-pill">
              <span className="project-icon">K</span>
              <div>
                <small>Current workspace</small>
                <strong>General Workspace</strong>
              </div>
              <span>⌄</span>
            </div>
            <button className="avatar" onClick={signOut} title="Sign out">JG</button>
          </div>
        </header>

        <div className="dashboard-grid">
          <section className="command-panel card">
            <div className="section-heading">
              <div>
                <span className="kicker">ORCHESTRATOR</span>
                <h2>What should Korben do?</h2>
              </div>
              <div className="voice-controls">
                <button
                  className={`voice-mode ${voiceMode ? "enabled" : ""}`}
                  onClick={toggleVoiceMode}
                  disabled={!speechSupported}
                >
                  <span className="pulse-dot" />
                  {voiceMode ? "Voice mode on" : "Voice mode"}
                </button>
              </div>
            </div>

            <div className="conversation">
              {messages.map((message, index) => (
                <div key={message.id || index} className={`message ${message.role}`}>
                  <div className="message-avatar">{message.role === "user" ? "JG" : "K"}</div>
                  <div className="message-bubble">{message.text}</div>
                </div>
              ))}
            </div>

            <div className={`composer ${listening ? "listening" : ""}`}>
              {listening && (
                <div className="listening-bar">
                  <span className="sound-bars"><i /><i /><i /><i /><i /></span>
                  Listening… speak naturally
                </div>
              )}
              <textarea
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  setInputMode("text");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Ask Korben to build, research, analyze or improve something…"
                rows={4}
              />
              <div className="composer-footer">
                <div className="composer-left">
                  <button className="icon-button" title="Attach context">＋</button>
                  <button
                    className={`mic-button ${listening ? "active" : ""}`}
                    onClick={toggleMic}
                    disabled={!speechSupported}
                    title={speechSupported ? "Talk to Korben" : "Speech recognition unavailable in this browser"}
                  >
                    ◉
                  </button>
                  <span className="shortcut">{voiceMode ? "Speak naturally — Korben sends when you finish" : <>Hold <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> to talk</>}</span>
                </div>
                <button className="send-button" onClick={() => sendMessage()} disabled={!input.trim() || sending}>{sending ? "Thinking…" : "Send"} <span>↗</span></button>
              </div>
            </div>
            {!speechSupported && (
              <div className="browser-note">
                Voice input is unavailable in this browser. Typed chat remains fully available.
              </div>
            )}
          </section>

          <aside className="agents-panel card">
            <div className="section-heading compact">
              <div>
                <span className="kicker">WEB DEVELOPMENT</span>
                <h3>Agent team</h3>
              </div>
              <span className="live-badge">● Live</span>
            </div>
            <div className="agent-list">
              {agents.map((agent) => (
                <div className="agent-row" key={agent.id}>
                  <div className="agent-avatar">{agent.name.slice(0, 2).toUpperCase()}</div>
                  <div className="agent-copy">
                    <strong>{agent.name}</strong>
                    <span>{agent.role}</span>
                    <small>{agent.status === "idle" ? "Ready" : agent.status}</small>
                  </div>
                  <span className={`status-pill ${agent.status.toLowerCase()}`}>{agent.status}</span>
                </div>
              ))}
            </div>
          </aside>

          <section className="plan-panel card">
            <div className="section-heading compact">
              <div>
                <span className="kicker">ACTIVE OBJECTIVE</span>
                <h3>{activeObjective}</h3>
              </div>
              <span className="progress-number">{progress}%</span>
            </div>
            <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
            <div className="execution-list">
              {tasks.map((task, index) => (
                <div className="execution-row" key={task.id}>
                  <div className={`step-index ${task.status === "complete" ? "complete" : task.status === "in_progress" ? "active" : "waiting"}`}>
                    {task.status === "complete" ? "✓" : index + 1}
                  </div>
                  <div className="step-copy">
                    <strong>{task.title}</strong>
                    <span>{task.description || ""}</span>
                  </div>
                  <span className={`step-status ${task.status === "complete" ? "complete" : task.status === "in_progress" ? "active" : "waiting"}`}>
                    {task.status === "complete" ? "Complete" : task.status === "in_progress" ? "In progress" : "Waiting"}
                  </span>
                </div>
              ))}
              {!tasks.length && (
                <div className="execution-row">
                  <div className="step-index waiting">1</div>
                  <div className="step-copy">
                    <strong>Waiting for your first objective</strong>
                    <span>Send Korben a typed or voice request.</span>
                  </div>
                  <span className="step-status waiting">Ready</span>
                </div>
              )}
            </div>
          </section>

          <section className="activity-panel card">
            <div className="section-heading compact">
              <div>
                <span className="kicker">ACTIVITY</span>
                <h3>Persistent workspace active</h3>
              </div>
            </div>
            <div className="activity-list">
              <div><span className="activity-icon done">✓</span><p><strong>Supabase connected</strong><small>Authenticated, organization-scoped data</small></p><time>Live</time></div>
              <div><span className="activity-icon done">✓</span><p><strong>Conversation persistence</strong><small>Typed and voice messages stored together</small></p><time>Live</time></div>
              <div><span className="activity-icon done">✓</span><p><strong>Objective creation</strong><small>Every request becomes structured work</small></p><time>Live</time></div>
              <div><span className="activity-icon active">↻</span><p><strong>AI orchestration</strong><small>Next phase: generate plans and assign agents</small></p><time>Next</time></div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
