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
  const [voiceState, setVoiceState] = useState<"waiting" | "listening" | "thinking" | "speaking">("waiting");
  const [speechSupported, setSpeechSupported] = useState(true);
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");
  const recognitionRef = useRef<any>(null);
  const heldShortcutRef = useRef(false);
  const sendingRef = useRef(false);
  const voiceModeRef = useRef(false);
  const voiceSubmittedRef = useRef(false);
  const wakeDetectedRef = useRef(false);
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

      let objective: { id: string; title: string } | null = null;
    let createdTasks: Task[] = [];

    if (plan.tasks.length > 0) {
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

      if (objective) {
        setActiveObjective(objective.title);

        const taskRows = plan.tasks.map((task, index) => ({
          objective_id: objective!.id,
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
              objective_id: objective!.id,
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
      }
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

    if (voiceModeRef.current && "speechSynthesis" in window) {
      setVoiceState("speaking");
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(reply);
      utterance.rate = 0.96;
      utterance.pitch = 0.92;

      const voices = window.speechSynthesis.getVoices();
      const preferredVoice =
        voices.find((voice) => /Google UK English Male/i.test(voice.name)) ||
        voices.find((voice) => /Microsoft.*(Guy|Ryan|Mark|David)/i.test(voice.name)) ||
        voices.find((voice) => /male/i.test(voice.name)) ||
        voices.find((voice) => voice.lang.startsWith("en"));

      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      utterance.onend = () => {
        wakeDetectedRef.current = false;
        voiceSubmittedRef.current = false;
        setVoiceState("waiting");
        window.setTimeout(() => {
          try {
            recognitionRef.current?.start();
          } catch {}
        }, 450);
      };

      utterance.onerror = () => {
        wakeDetectedRef.current = false;
        voiceSubmittedRef.current = false;
        setVoiceState("waiting");
      };

      window.speechSynthesis.speak(utterance);
    } else {
      wakeDetectedRef.current = false;
      voiceSubmittedRef.current = false;
      setVoiceState("waiting");
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
            ? "Say “Korben”"
            : "Voice standby";

  return (
    <main className="korben-shell">
      <header className="korben-topbar">
        <div className="korben-wordmark">
          <span className="mini-core">K</span>
          <div>
            <strong>KORBEN</strong>
            <small>Multi-Agent Operating System</small>
          </div>
        </div>

        <div className="korben-top-actions">
          <span className="workspace-chip">General Workspace</span>
          <button className="avatar" onClick={signOut} title="Sign out">JG</button>
        </div>
      </header>

      <section className="korben-stage">
        <div className="ambient-grid" />

        <div className="core-column">
          <div
            className={`korben-core ${voiceState} ${voiceMode ? "armed" : ""}`}
            onClick={voiceMode ? toggleMic : toggleVoiceMode}
            role="button"
            tabIndex={0}
            aria-label="Korben voice core"
          >
            <div className="core-orbit orbit-one" />
            <div className="core-orbit orbit-two" />
            <div className="core-orbit orbit-three" />
            <div className="core-energy" />
            <div className="core-center">
              <span>K</span>
            </div>
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
                      ? "Wake me by saying “Korben”."
                      : "Activate voice mode or type below."}
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
            <button className="voice-secondary" onClick={beginListening} disabled={!speechSupported || sending}>
              Talk now
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
    </main>
  );
}
