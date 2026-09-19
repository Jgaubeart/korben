# Korben v1 Architecture

Korben is a multi-agent operating system. The first department is Web Development.

## Core loop

1. User sends typed or voice input.
2. Orchestrator converts the request into an objective.
3. Product Manager clarifies requirements only when necessary.
4. Architect creates the implementation plan.
5. Orchestrator creates structured tasks and dependencies.
6. Specialist agents execute tasks with approved tools.
7. QA and Security review the work.
8. DevOps produces a preview deployment.
9. Owner approves production-impacting actions.
10. Korben records the result, artifacts, decisions, and activity.

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

Korben gets its own Supabase project. Cabinet Genies Portal remains a separate workload and data boundary.
