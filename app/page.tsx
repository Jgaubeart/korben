"use client";

import { useEffect, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  text: string;
};

type Agent = {
  name: string;
  role: string;
  status: "Working" | "Complete" | "Waiting" | "Idle";
  detail: string;
};

const agents: Agent[] = [
  { name: "Korben", role: "Orchestrator", status: "Working", detail: "Coordinating the build" },
  { name: "Atlas", role: "Product Manager", status: "Complete", detail: "Requirements drafted" },
  { name: "Archer", role: "Solutions Architect", status: "Working", detail: "Reviewing architecture" },
  { name: "Pixel", role: "UX / UI Designer", status: "Idle", detail: "Ready" },
  { name: "Forge", role: "Frontend Engineer", status: "Waiting", detail: "Waiting on plan" },
  { name: "Stack", role: "Backend Engineer", status: "Waiting", detail: "Waiting on plan" },
  { name: "Schema", role: "Database Engineer", status: "Waiting", detail: "Waiting on plan" },
  { name: "Sentinel", role: "QA Engineer", status: "Idle", detail: "Ready" },
];

const executionSteps = [
  ["Product Spec", "Define requirements and acceptance criteria", "complete"],
  ["Architecture Review", "Map dependencies and implementation path", "active"],
  ["Task Breakdown", "Create structured engineering tasks", "waiting"],
  ["Build", "Frontend, backend and database implementation", "waiting"],
  ["QA & Security", "Test behavior, permissions and regressions", "waiting"],
  ["Preview Deploy", "Ship a Vercel preview for review", "waiting"],
];

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Good morning. I’m ready to coordinate your Web Development team. What should we build?",
    },
  ]);
  const [listening, setListening] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef<any>(null);
  const heldShortcutRef = useRef(false);

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

    recognition.onstart = () => setListening(true);
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

  const sendMessage = () => {
    const text = input.trim();
    if (!text) return;

    setMessages((current) => [
      ...current,
      { role: "user", text },
      {
        role: "assistant",
        text: "Understood. I’ll turn that into a structured objective, identify the right specialists, and prepare an execution plan before anything important ships.",
      },
    ]);
    setInput("");
  };

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
          <button className="nav-item"><span>✓</span>Tasks <b>7</b></button>
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
            <strong>System online</strong>
            <span>Development workspace</span>
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
                <div key={index} className={`message ${message.role}`}>
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
                onChange={(event) => setInput(event.target.value)}
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
                <div className="agent-row" key={agent.name}>
                  <div className="agent-avatar">{agent.name.slice(0, 2).toUpperCase()}</div>
                  <div className="agent-copy">
                    <strong>{agent.name}</strong>
                    <span>{agent.role}</span>
                    <small>{agent.detail}</small>
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
                <h3>Build Korben Command Center</h3>
              </div>
              <span className="progress-number">32%</span>
            </div>
            <div className="progress-track"><span style={{ width: "32%" }} /></div>
            <div className="execution-list">
              {executionSteps.map(([title, description, status], index) => (
                <div className="execution-row" key={title}>
                  <div className={`step-index ${status}`}>
                    {status === "complete" ? "✓" : index + 1}
                  </div>
                  <div className="step-copy">
                    <strong>{title}</strong>
                    <span>{description}</span>
                  </div>
                  <span className={`step-status ${status}`}>
                    {status === "complete" ? "Complete" : status === "active" ? "In progress" : "Waiting"}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="activity-panel card">
            <div className="section-heading compact">
              <div>
                <span className="kicker">ACTIVITY</span>
                <h3>Live run log</h3>
              </div>
              <button className="text-button">View all</button>
            </div>
            <div className="activity-list">
              <div><span className="activity-icon done">✓</span><p><strong>Project initialized</strong><small>Next.js app connected to Vercel</small></p><time>Today</time></div>
              <div><span className="activity-icon done">✓</span><p><strong>Feature branch created</strong><small>phase-1-command-center</small></p><time>Now</time></div>
              <div><span className="activity-icon active">↻</span><p><strong>Building Command Center</strong><small>Chat, voice and team workspace</small></p><time>Now</time></div>
              <div><span className="activity-icon waiting">○</span><p><strong>Preview deployment</strong><small>Waiting for implementation</small></p><time>Next</time></div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
