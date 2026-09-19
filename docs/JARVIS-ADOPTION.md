# JARVIS Build Review → KorbenOS Adoption

Reviewed source: uploaded `brain-jarvis-skill-v7-windows` package.

## What the JARVIS build does well

The strongest architectural idea is its **organ model**: capabilities such as Focus, Eyes, Watch, Holo, Calls, Tools, Presence and Missions each have their own explicit state, activation boundary and feedback loop. That makes the assistant feel observable instead of opaque.

Other useful patterns:

- **Preflight health checks** before trusting autonomous execution.
- **Acknowledge → execute → report** interaction loop.
- **Focus/accountability sessions** with timer, drift detection and report cards.
- **Bounded conversational continuity** for follow-ups such as “check again” or “continue.”
- **Exact capability/action contracts** so agents do not guess unsupported tool actions.
- **Explicit opt-in for sensors** such as camera and screen.
- **Runtime model/profile switching** without changing the persistent default.
- **Safe-fact packs** that separate approved operational facts from unrestricted memory.
- **Proactive briefings/reminders** as an assistant-initiated layer.
- **Tool discovery/armory** instead of hiding integrations behind implementation details.

## Adopted into KorbenOS

### Preflight
Korben now has an authenticated project-scoped health endpoint and UI module that checks:

- OpenAI
- Supabase
- GitHub authorization for the active project
- Vercel authorization for the active project
- agent registry
- tool registry and executable permissions
- scoped Brain entries
- pending approvals
- recent execution errors

This is intentionally project-aware rather than hard-coded to KorbenOS.

### Focus
Korben now has a privacy-safe Focus organ:

- 15/25/30/45/60 minute sessions
- user-defined goal
- pause/resume
- optional “Lock this tab”
- browser visibility drift counter
- optional spoken drift callout when voice mode is active
- end-of-session report card
- local completion streak

The tab lock uses only browser visibility. Korben does **not** know what other tab/app the user opened.

### Runtime state
The sidebar now exposes a more meaningful system state such as:

- Listening
- Thinking
- Speaking
- Executing
- Blocked · approval
- Focus active / paused

### Follow-up context
The orchestrator receives a bounded recent conversation window so it can resolve:

- “continue that”
- “check again”
- “that’s wrong”
- pronouns and references to the immediately preceding work

Recent context never grants fresh L2/L3 approval.

## Already present in Korben before this review

Korben already had stronger versions of several JARVIS concepts:

- governed multi-agent routing
- project-scoped tools
- explicit L0–L3 approval boundaries
- execution ledger / run events
- shared Brain and SOP registry
- downstream agent handoff
- automatic project resolution
- GitHub/Vercel/Supabase adapters
- completion reporting back into the Command Center

## Deferred intentionally

### EYES / webcam awareness
Useful, but should not be copied casually. Before adding it Korben needs:

- per-session opt-in
- visible capture indicator
- no background recording
- explicit retention policy
- strict one-frame/ephemeral analysis path
- browser permission failure UX

### WATCH / screen understanding
Potentially valuable for “what is on my screen?” and computer guidance, but it needs a deliberate screen-sharing architecture and privacy model. It should be separate from ordinary Korben conversation.

### HOLO / hand gestures
Visually interesting but low priority for operating-system usefulness. This is a presentation layer, not core capability.

### Desktop takeover / computer control
Korben should use governed Computer Use / Work-style execution rather than copy JARVIS's local desktop-control approach. Any takeover capability must remain explicit, observable and interruptible.

### Phone / Retell
Valuable future organ for calls, but requires a provider decision, phone-number lifecycle, call-safe facts, consent rules and external-communication approval policy.

### Proactive briefings
High-value next phase. Should be built on Korben's own objective/task/Brain data and scheduled delivery rather than copied from JARVIS's local Python scheduler.

### Model hot-swap
Potentially useful as “reasoning profiles” or named model profiles. It should remain secondary to Korben's agent-role routing so the user does not have to think about models during normal operation.

### Safe Fact Pack
Recommended next. Add an explicit store of owner-approved facts that calling/customer-facing agents may use, separate from the broader Brain.

## Recommended next JARVIS-inspired Korben phases

1. **Safe Fact Packs** for external-facing agents.
2. **Proactive Briefings** (morning / project / exception summaries).
3. **Voice commands for Focus** so “Korben, give me 30 minutes on this” starts the Focus organ directly.
4. **Sensor framework** with explicit session permissions before adding camera/screen organs.
5. **Phone organ** after safe facts and communication approvals are mature.
6. **Model profiles** only if there is a concrete need for manual model switching.

## Architectural principle

Do not turn Korben into a clone of JARVIS.

Korben should keep its server-governed, auditable multi-agent architecture and adopt JARVIS's strongest interaction patterns: explicit organs, visible state, opt-in sensing, preflight checks, proactive assistance, and strong feedback after actions.
