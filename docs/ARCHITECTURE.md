# Korben v1 Architecture

Korben is a multi-agent operating system. The first department is Web Development.

## Core loop

1. User sends typed or voice input.
2. Korben classifies the intent as conversation, question, work, action, or approval-required action.
3. Conversation and question intents return directly without creating objectives or tasks.
4. Work/action intents become an objective only when structured work is actually required.
5. Korben routes tasks to specialist agents.
6. Each agent may use only tools explicitly granted through the agent-tool permission registry.
7. Tool calls are written to the run-event ledger.
8. Level 2 and Level 3 actions require an approved approval record before the Tool Gateway will execute them.
9. QA and Security review the work.
10. DevOps produces a preview deployment.
11. Owner approves production-impacting actions.
12. Korben records results, artifacts, decisions, and activity.

## Input modes

- Typed chat
- Click-to-talk
- Alt + Space push-to-talk
- Continuous voice mode
- Wake word later

All inputs enter the same conversation and orchestrator context.

## Initial Web Development agents

- Korben — Orchestrator
- Atlas — Product Manager
- Archer — Solutions Architect
- Pixel — UX / UI Designer
- Forge — Frontend Engineer
- Stack — Backend Engineer
- Schema — Database Engineer
- Sentinel — QA Engineer
- Guardian — Security Reviewer
- Launch — DevOps / Release Engineer

## Approval levels

- Level 0: read-only and planning actions
- Level 1: reversible feature-branch work and preview deployments
- Level 2: migrations, permissions, environment/config changes, merge-ready actions
- Level 3: production deployment, destructive data changes, external communication

## Data boundary

Korben uses explicit project boundaries. External products and business systems are not available to Korben until the user adds them as projects and supplies setup instructions and connections.


## Intent model

- conversation — casual interaction; no work object
- question — informational or analytical response; no work object
- work — structured tasks, no immediate external side effect
- action — external tool use at Level 0 or Level 1
- approval — requested action requiring Level 2 or Level 3 approval

## Tool Gateway

Runtime tools are server-side only. Browser clients never receive provider credentials.

The gateway validates:

1. authenticated Supabase user
2. accessible project
3. agent identity
4. agent-to-tool permission
5. tool risk level
6. approval record for Level 2/3 actions
7. run-event logging before and after execution

Initial adapters:

- GitHub read/write/pull request/merge
- Vercel read
- Supabase read

Registered next adapters:

- Vercel preview/production
- Supabase SQL/migrations
- knowledge search (G-Brain / Obsidian)
