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
    let orchestrationRunId: string | null = null;

    if (plan.tasks.length > 0 && !["conversation", "question"].includes(plan.intent)) {
      const { data: createdObjective } = await supabase
        .from("objectives")
        .insert({
          project_id: resolvedProjectId,
          conversation_id: resolvedConversationId,
          title: plan.title,
          description: plan.summary || text,
          status: plan.intent === "approval" ? "awaiting_approval" : "planned",
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
          status: task.approval_level >= 2 ? "awaiting_approval" : "queued",
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
              objective_id: objective!.id,
              task_id: createdTask.id,
              action_type: task.title,
              risk_level: task.approval_level,
              status: "pending",
              request_payload: {
                description: task.description,
                agent_system_key: task.agent_system_key,
                intent: plan.intent,
              },
            },
          ];
        });

        if (approvals.length) {
          await supabase.from("approvals").insert(approvals);
        }

        const orchestrator = agents.find((agent) => agent.system_key === "orchestrator");
        const { data: run } = await supabase
          .from("agent_runs")
          .insert({
            agent_id: orchestrator?.id || null,
            status: "complete",
            model: "gpt-5.6-sol",
            input: {
              request: text,
              input_mode: currentInputMode,
              intent: plan.intent,
            },
            output: plan,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        orchestrationRunId = run?.id || null;

        if (createdTasks.length) {
          await supabase.from("run_events").insert(
            createdTasks.map((task) => {
              const owner = agents.find((agent) => agent.id === task.assigned_agent_id);
              return {
                run_id: orchestrationRunId,
                project_id: resolvedProjectId,
                task_id: task.id,
                agent_id: task.assigned_agent_id || null,
                event_type: "task_routed",
                status: task.status,
                message: owner
                  ? `Routed "${task.title}" to ${owner.name}`
                  : `Created unassigned task "${task.title}"`,
                payload: {
                  objective_id: objective!.id,
                  intent: plan.intent,
                },
              };
            })
          );
        }
      }
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
          run_id: orchestrationRunId,
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
                        <small>{assignedTask ? assignedTask.title : "No routed task"}</small>
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
        description: "An honest inventory of what Korben can use now and what still needs a connector.",
        cards: [
          ["OpenAI Orchestrator", "Configured", "Conversation and structured planning."],
          ["Supabase", "Connected", "Auth, persistence, objectives, tasks, runs and approvals."],
          ["Browser Voice", "Connected", "Wake listening, transcription and spoken replies."],
          ["GitHub Execution", "Next", "Branch, code, commit, pull request and review actions."],
          ["Vercel Execution", "Next", "Preview inspection and controlled deployment actions."],
          ["G-Brain Retrieval", "Not configured", "Shared semantic knowledge retrieval."],
          ["Obsidian Vault", "Not configured", "Local/source Markdown knowledge access."]
        ]
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
