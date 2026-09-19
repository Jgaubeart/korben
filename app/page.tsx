"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

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
};

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  sequence: number;
};

const fallbackGreeting: Message = {
  role: "assistant",
  text: "Good morning. I’m ready to coordinate your Web Development team. What should we build?",
};

export default function Home() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([fallbackGreeting]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeObjective, setActiveObjective] = useState<string>("No active objective");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loadingState, setLoadingState] = useState("Connecting…");
  const [listening, setListening] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");
  const recognitionRef = useRef<any>(null);
  const heldShortcutRef = useRef(false);

  useEffect(() => {
    const bootstrap = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setLoadingState("Sign in required");
        return;
      }

      const { data: project } = await supabase
        .from("projects")
        .select("id,name")
        .eq("slug", "cabinet-genies-portal")
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
          .select("id,name,role,status")
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
      setListening(true);
      setInputMode("voice");
    };
    recognition.onend = () => {
      setListening(false);
      if (voiceMode && !heldShortcutRef.current) {
        window.setTimeout(() => {
          try {
            recognition.start();
          } catch {}
        }, 300);
      }
    };
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript.trim());
    };

    recognitionRef.current = recognition;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.code === "Space" && !event.repeat) {
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
  }, [voiceMode]);

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

  const buildDefaultTasks = (objectiveId: string) => [
    {
      objective_id: objectiveId,
      title: "Product Spec",
      description: "Define requirements and acceptance criteria",
      status: "queued",
      sequence: 1,
    },
    {
      objective_id: objectiveId,
      title: "Architecture Review",
      description: "Map dependencies and implementation path",
      status: "queued",
      sequence: 2,
    },
    {
      objective_id: objectiveId,
      title: "Task Breakdown",
      description: "Create structured engineering tasks",
      status: "queued",
      sequence: 3,
    },
    {
      objective_id: objectiveId,
      title: "Build",
      description: "Frontend, backend and database implementation",
      status: "queued",
      sequence: 4,
    },
    {
      objective_id: objectiveId,
      title: "QA & Security",
      description: "Test behavior, permissions and regressions",
      status: "queued",
      sequence: 5,
    },
    {
      objective_id: objectiveId,
      title: "Preview Deploy",
      description: "Ship a Vercel preview for review",
      status: "queued",
      sequence: 6,
    },
  ];

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !conversationId || !projectId) return;

    setInput("");
    const userMessage: Message = { role: "user", text, inputMode };
    setMessages((current) => [...current, userMessage]);

    const { data: insertedMessage } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "user",
        content: text,
        input_mode: inputMode,
      })
      .select("id")
      .single();

    const objectiveTitle = text.length > 72 ? `${text.slice(0, 69)}…` : text;
    const { data: objective } = await supabase
      .from("objectives")
      .insert({
        project_id: projectId,
        conversation_id: conversationId,
        title: objectiveTitle,
        description: text,
        status: "planning",
        priority: "normal",
      })
      .select("id,title")
      .single();

    if (objective) {
      setActiveObjective(objective.title);
      const { data: createdTasks } = await supabase
        .from("tasks")
        .insert(buildDefaultTasks(objective.id))
        .select("id,title,description,status,sequence")
        .order("sequence");
      setTasks(createdTasks || []);
    }

    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    const reply =
      "Understood. I saved this as a real objective and created the initial Web Development execution plan. Next, the orchestrator will replace this default plan with an AI-generated plan and assign specialist agents.";

    const assistantMessage: Message = { role: "assistant", text: reply };
    setMessages((current) => [...current, assistantMessage]);

    await supabase.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: reply,
      input_mode: "system",
    });

    await supabase.from("activity_events").insert([
      {
        project_id: projectId,
        objective_id: objective?.id || null,
        event_type: "message_received",
        message: "New Command Center request received",
        metadata: {
          input_mode: inputMode,
          message_id: insertedMessage?.id || null,
        },
      },
      {
        project_id: projectId,
        objective_id: objective?.id || null,
        event_type: "objective_created",
        message: objective ? `Objective created: ${objective.title}` : "Objective creation attempted",
        metadata: {},
      },
    ]);

    setInputMode("text");
  };

  const completedTasks = tasks.filter((task) => task.status === "complete").length;
  const progress = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0;

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
              <span className="project-icon">CG</span>
              <div>
                <small>Current project</small>
                <strong>Cabinet Genies Portal</strong>
              </div>
              <span>⌄</span>
            </div>
            <button className="avatar">JG</button>
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
                  <span className="shortcut">Hold <kbd>Alt</kbd> + <kbd>Space</kbd> to talk</span>
                </div>
                <button className="send-button" onClick={sendMessage}>Send <span>↗</span></button>
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
