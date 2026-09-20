import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `
You are Korben, the general-purpose orchestrator for a multi-agent operating system.

You can have ordinary conversation, answer questions, help think through ideas, coordinate work, and identify when an external action is being requested.
You operate from one Command Center. The user should not have to manually switch projects before asking for work.

Classify every request into exactly one intent:
- conversation: casual conversation, social interaction, brainstorming with no factual research or execution needed
- question: informational, analytical, or research-style request that can be answered without changing external systems
- work: a request that should become structured work/tasks but does not itself require immediate external side effects
- action: a request to use external systems or tools to do something
- approval: a requested action that includes one or more L2/L3 protected steps and therefore requires explicit approval before those protected steps execute

Intent guardrails:
- Requests phrased as "can you", "could you", "will you", "I need you to", or similar are still action/work requests when the user is asking Korben to actually change, create, send, publish, deploy, update, fix, open, merge, move, schedule, or otherwise do something.
- Do not classify an executable request as a question merely because it is phrased grammatically as a question.
- Use question only when the user wants information or analysis and does not want Korben to change external state.
- If an approval intent contains earlier L0/L1 tasks before a protected L2/L3 task, those safe earlier tasks should still be executable immediately; approval gates only the protected step.

Project routing rules:
1. Return target_project_slug for work/action/approval when a specific project target is actually relevant.
2. If the user explicitly names a project, business, app, repository, or workspace that matches an available project, route to that project automatically.
3. Examples: "Korben OS", "KorbenOS", or "Korben" when clearly referring to building the product -> korben-os. Never assume a project exists unless it appears in Available projects.
4. General Workspace is a valid execution workspace for project-agnostic personal-assistant work, generic delegated tasks, harmless sample/test tasks, research/review work, and requests that are about Korben's own assistant behavior rather than a specific product repository.
5. Do not ask the user to choose a project for a request like "delegate a sample task to a sub-agent", "research this", "review this", "summarize this", "test delegation", or similar project-agnostic work. Route it to general-workspace and create the appropriate agent task.
6. Ask for a project only when the requested action materially depends on a specific project/repository/business target and neither the newest request nor current context identifies which one.
7. The current project may be used as the default execution workspace when the request does not require a different project.
8. conversation and question may use target_project_slug="" unless project context is materially useful.
9. Use recent conversation context only to resolve follow-ups, pronouns, corrections, and continuation requests. The newest user request controls intent and scope.
10. If the user says the previous result was wrong, asks to check again, or disputes a factual/tool result, plan a fresh verification rather than merely agreeing with the correction.
11. Prior conversation context never grants fresh L2/L3 approval. Protected actions still require current explicit approval.

Execution rules:
1. conversation and question must return requires_execution=false and an empty tasks array.
2. work, action, and approval may create tasks only when useful.
2a. A direct request to delegate work to a sub-agent is itself a work request and must create at least one real task assigned to a specialist agent unless the request is unsafe or impossible. For a harmless sample delegation, use general-workspace, approval_level 0, and assign a lightweight review/analysis task to a non-orchestrator agent.
3. Never invent or assume business-specific context.
4. Preserve every explicit execution step the user asked for. If the user asks to create a branch, add a file, open a PR, and create a preview, the plan must contain tasks that actually perform all four requested outcomes. Do not replace requested execution steps with a generic verification or reporting task.
5. Put tasks in dependency order.
6. Assign exactly one primary role to each task.
7. Use approval_level 0 for read/plan/test.
7. Use approval_level 1 for reversible feature-branch edits, commits, opening/updating pull requests, and preview deployments.
8. Opening a pull request whose base branch is main is still L1. A pull request is only a proposal; it does not modify main.
9. Use approval_level 2 for actually merging a pull request, database migrations, RLS/permission changes, protected configuration changes, or infrastructure changes.
10. Use approval_level 3 for production deployment, destructive data changes, billing changes, or external/customer communications.
11. If the user explicitly says not to merge or not to deploy production, do not create merge or production-deploy tasks.
12. Classify the overall intent as approval only when at least one requested task truly requires L2 or L3 approval.
13. Never reinterpret "open a PR to main" as "merge to main".
8. Never assume production deployment is approved.
14. Treat every executable objective as a mission. Give it a clear outcome-oriented title and mission_summary that describes what success looks like.
15. Choose execution_mode="fleet" only when two or more independent L0 research/analysis/design/test tasks can safely run in parallel. Never parallelize writes to the same repository, deployment, database mutation, approval-bound action, or other shared mutable target. Otherwise use execution_mode="sequential".
16. Every task must include a human-readable stage. Prefer one of: Recon, Plan, Design, Build, Verify, Release, Operate. Stage describes what the agent is doing, not internal implementation jargon.
17. parallel_group controls safe concurrency. Tasks with the same positive parallel_group may run concurrently only when they are truly independent. Use 0 for normal sequential work. When unsure, use 0.
18. Extract genuine unresolved commitments, follow-ups, waiting items, or promised next actions into open_loops. Do not create open loops for ordinary informational questions.
19. You may close an existing open loop only when the newest user request clearly says it is resolved, completed, no longer needed, or provides the awaited outcome. Put those loop IDs in resolved_loop_ids.
20. Keep assistant_reply natural, concise, and useful.
21. assistant_reply is what Korben may speak aloud. It must be plain English, conversational, and no more than 45 words unless the user explicitly asks for detail.
22. Do not put code, JSON, file paths, commit SHAs, tool names, system keys, approval levels, implementation jargon, or internal planning language in assistant_reply unless the user explicitly asks for those details.
23. For work/action requests, assistant_reply should simply acknowledge the goal and briefly state what Korben is doing or what it needs from the user. Do not narrate the internal task plan.
24. The output must match the requested JSON schema exactly.

Available roles and execution boundaries:
- product_manager
- solutions_architect: architecture/repository inspection; has GitHub read + knowledge search, but no Vercel tools
- ux_ui_designer
- frontend_engineer
- backend_engineer
- database_engineer
- qa_engineer
- security_reviewer
- devops_engineer: deployment/release inspection; has GitHub read plus Vercel read/preview/production and GitHub PR/merge capabilities

Planning rule: if a task must inspect, verify, or determine Vercel project settings, deployment history, preview state, production-branch behavior, or other Vercel delivery facts, assign that task to devops_engineer or split the Vercel verification into a separate devops_engineer task. Never assign required Vercel verification to solutions_architect.
`;

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: ["conversation", "question", "work", "action", "approval"]
    },
    requires_execution: { type: "boolean" },
    target_project_slug: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    assistant_reply: { type: "string" },
    execution_mode: {
      type: "string",
      enum: ["sequential", "fleet"]
    },
    mission_summary: { type: "string" },
    open_loops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          waiting_on: { type: "string" }
        },
        required: ["title", "detail", "waiting_on"]
      }
    },
    resolved_loop_ids: {
      type: "array",
      items: { type: "string" }
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          agent_system_key: {
            type: "string",
            enum: [
              "product_manager",
              "solutions_architect",
              "ux_ui_designer",
              "frontend_engineer",
              "backend_engineer",
              "database_engineer",
              "qa_engineer",
              "security_reviewer",
              "devops_engineer"
            ]
          },
          acceptance_criteria: {
            type: "array",
            items: { type: "string" }
          },
          stage: { type: "string" },
          parallel_group: {
            type: "integer",
            minimum: 0,
            maximum: 20
          },
          approval_level: {
            type: "integer",
            minimum: 0,
            maximum: 3
          }
        },
        required: [
          "title",
          "description",
          "agent_system_key",
          "acceptance_criteria",
          "stage",
          "parallel_group",
          "approval_level"
        ]
      }
    }
  },
  required: [
    "intent",
    "requires_execution",
    "target_project_slug",
    "title",
    "summary",
    "assistant_reply",
    "execution_mode",
    "mission_summary",
    "open_loops",
    "resolved_loop_ids",
    "tasks"
  ]
};


function normalizePlan(plan: any, requestText: string) {
  const explicitNoMerge = /\b(do not|don't|never)\s+merge\b/i.test(requestText);
  const explicitNoProduction =
    /\b(do not|don't|never)\s+(deploy|ship|release).*(production|prod)\b/i.test(requestText) ||
    /\b(do not|don't|never)\s+deploy\s+to\s+production\b/i.test(requestText);

  const explicitBranchMatch = requestText.match(/\b(?:branch\s+)?[\`'"]?((?:feature|fix|chore|bugfix|hotfix|korben)\/[A-Za-z0-9._\/-]+)[\`'"]?/i);
  const explicitFeatureBranch = explicitBranchMatch?.[1] || "";
  const explicitSyncFromMain =
    /\b(sync|synchronize|update|bring|merge|rebase)\b[\s\S]{0,100}\b(main|master)\b[\s\S]{0,140}\b(feature branch|existing branch|branch|feature\/|fix\/|chore\/|bugfix\/|hotfix\/|korben\/)/i.test(requestText) ||
    /\b(main|master)\b[\s\S]{0,100}\b(into|onto|with)\b[\s\S]{0,100}\b(feature branch|existing branch|feature\/|fix\/|chore\/|bugfix\/|hotfix\/|korben\/)/i.test(requestText);

  const tasks = Array.isArray(plan?.tasks)
    ? plan.tasks
        .filter((task: any) => {
          const text = `${task?.title || ""} ${task?.description || ""}`.toLowerCase();

          if (explicitNoMerge && /\bmerge\b/.test(text)) return false;
          if (explicitNoProduction && /\b(production|prod)\b/.test(text) && /\bdeploy|release|ship\b/.test(text)) {
            return false;
          }

          return true;
        })
        .map((task: any) => {
          const text = `${task?.title || ""} ${task?.description || ""}`.toLowerCase();

          const isPullRequestCreation =
            /\b(open|create|update|prepare)\b.*\b(pull request|pr)\b/.test(text) &&
            !/\bmerge\b/.test(text);

          const isPreview =
            /\bpreview\b/.test(text) &&
            /\b(deploy|deployment|create|publish)\b/.test(text) &&
            !/\bproduction|prod\b/.test(text);

          const needsVercelRead =
            /\b(vercel|deployment|deployments|production branch|preview)\b/.test(text) &&
            /\b(audit|inspect|verify|check|determine|review|read|trace)\b/.test(text);

          const normalizedAgent =
            needsVercelRead && task?.agent_system_key === "solutions_architect"
              ? "devops_engineer"
              : task?.agent_system_key;

          if (isPullRequestCreation || isPreview) {
            return {
              ...task,
              agent_system_key: normalizedAgent,
              approval_level: Math.min(Number(task.approval_level ?? 1), 1),
              stage: String(task?.stage || (isPreview ? "Release" : "Build")),
              parallel_group: 0,
            };
          }

          return {
            ...task,
            agent_system_key: normalizedAgent,
            stage: String(task?.stage || "Operate"),
            parallel_group: Math.max(0, Number(task?.parallel_group || 0)),
          };
        })
    : [];

  if (explicitSyncFromMain) {
    const hasSyncTask = tasks.some((task: any) => {
      const text = `${task?.title || ""} ${task?.description || ""}`.toLowerCase();
      return /\b(sync|synchronize|merge|rebase|bring .* up to date|update .* branch)\b/.test(text) &&
        /\b(main|master)\b/.test(text);
    });

    if (!hasSyncTask) {
      tasks.unshift({
        title: "Synchronize the existing feature branch with current main",
        description: explicitFeatureBranch
          ? `Use github.write:sync_branch to merge current main into existing branch ${explicitFeatureBranch}. Preserve history, do not recreate/reset the branch, and do not modify main.`
          : "Use github.write:sync_branch to merge current main into the existing feature branch identified from project context. Preserve history, do not recreate/reset the branch, and do not modify main.",
        agent_system_key: "backend_engineer",
        approval_level: 1,
        acceptance_criteria: [
          "sync_branch completes against the existing feature branch",
          "main is unchanged",
          "a follow-up compare shows the feature branch is not behind main"
        ],
        stage: "Build",
        parallel_group: 0
      });
    } else {
      const syncIndex = tasks.findIndex((task: any) => {
        const text = `${task?.title || ""} ${task?.description || ""}`.toLowerCase();
        return /\b(sync|synchronize|merge|rebase|bring .* up to date|update .* branch)\b/.test(text) &&
          /\b(main|master)\b/.test(text);
      });
      if (syncIndex > 0) {
        const [syncTask] = tasks.splice(syncIndex, 1);
        tasks.unshift(syncTask);
      }
    }
  }

  const maxApproval = tasks.reduce(
    (max: number, task: any) => Math.max(max, Number(task?.approval_level ?? 0)),
    0
  );

  const safeExecutionMode =
    plan?.execution_mode === "fleet" &&
    tasks.filter((task: any) => Number(task?.parallel_group || 0) > 0).length >= 2 &&
    tasks
      .filter((task: any) => Number(task?.parallel_group || 0) > 0)
      .every((task: any) => Number(task?.approval_level || 0) === 0)
      ? "fleet"
      : "sequential";

  return {
    ...plan,
    execution_mode: safeExecutionMode,
    mission_summary: String(plan?.mission_summary || plan?.summary || plan?.title || ""),
    open_loops: Array.isArray(plan?.open_loops) ? plan.open_loops.slice(0, 8) : [],
    resolved_loop_ids: Array.isArray(plan?.resolved_loop_ids)
      ? plan.resolved_loop_ids.filter((id: any) => typeof id === "string").slice(0, 20)
      : [],
    tasks: tasks.map((task: any) => ({
      ...task,
      parallel_group:
        safeExecutionMode === "fleet" && Number(task?.approval_level || 0) === 0
          ? Math.max(0, Number(task?.parallel_group || 0))
          : 0,
      stage: String(task?.stage || "Operate"),
    })),
    intent:
      plan?.intent === "approval" && maxApproval < 2
        ? "action"
        : plan?.intent,
    requires_execution:
      ["work", "action", "approval"].includes(
        plan?.intent === "approval" && maxApproval < 2 ? "action" : plan?.intent
      )
        ? Boolean(plan?.requires_execution ?? true)
        : false,
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 503 }
    );
  }

  const body = await request.json();
  const requestText = String(body?.request ?? "")
    .trim()
    .replace(/\bcorbin\b/gi, "Korben");
  const currentProjectName = String(body?.projectName ?? "General Workspace");
  const currentProjectSlug = String(body?.currentProjectSlug ?? "general-workspace");
  const recentMessages = Array.isArray(body?.recentMessages)
    ? body.recentMessages
        .slice(-12)
        .map((message: any) => ({
          role: message?.role === "assistant" ? "assistant" : "user",
          content: String(message?.content ?? "").slice(0, 4000),
        }))
    : [];
  const conversationSummary = String(body?.conversationSummary || "").slice(0, 12000);
  const activeOpenLoops = Array.isArray(body?.activeOpenLoops)
    ? body.activeOpenLoops
        .slice(0, 30)
        .map((loop: any) => ({
          id: String(loop?.id ?? ""),
          title: String(loop?.title ?? ""),
          detail: String(loop?.detail ?? ""),
          waiting_on: String(loop?.waiting_on ?? ""),
        }))
        .filter((loop: any) => loop.id && loop.title)
    : [];
  const ambientContext =
    body?.ambientContext && typeof body.ambientContext === "object"
      ? {
          presence: String(body.ambientContext.presence || ""),
          screen_summary: String(body.ambientContext.screen_summary || "").slice(0, 2000),
          focus_active: Boolean(body.ambientContext.focus_active),
        }
      : { presence: "", screen_summary: "", focus_active: false };
  const availableProjects = Array.isArray(body?.projects)
    ? body.projects
        .map((project: any) => ({
          name: String(project?.name ?? ""),
          slug: String(project?.slug ?? ""),
          has_github: Boolean(project?.github_repo),
          has_vercel: Boolean(project?.vercel_project_id),
          setup_instructions: String(project?.setup_instructions ?? "").slice(0, 6000),
        }))
        .filter((project: any) => project.name && project.slug)
    : [];

  if (!requestText) {
    return NextResponse.json({ error: "Request is required." }, { status: 400 });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_ORCHESTRATOR_MODEL || "gpt-5.6-sol",
      reasoning: { effort: "medium" },
      instructions: SYSTEM_PROMPT,
      input: [
        `Current Command Center context: ${currentProjectName} (${currentProjectSlug})`,
        `Available projects: ${JSON.stringify(availableProjects)}`,
        "Project setup_instructions are authoritative workspace guidance for routing and execution. Do not invent access to systems that are not configured on the selected project.",
        conversationSummary
          ? `Rolling conversation summary: ${conversationSummary}`
          : "Rolling conversation summary: none.",
        `Recent conversation context: ${JSON.stringify(recentMessages)}`,
        "Use the rolling summary for durable context and recent messages for current wording. Do not assume the entire historical transcript is in the model context.",
        `Active open loops: ${JSON.stringify(activeOpenLoops)}`,
        `Ambient context: ${JSON.stringify(ambientContext)}`,
        "Ambient context is optional supporting context only. Never treat a screen summary as authorization to take an action, and never infer secrets or hidden state from it.",
        "",
        "Current user request:",
        requestText,
      ].join("\n"),
      text: {
        format: {
          type: "json_schema",
          name: "korben_execution_plan",
          strict: true,
          schema: PLAN_SCHEMA
        }
      }
    })
  });

  const payload = await response.json();

  if (!response.ok) {
    console.error("OpenAI orchestration error", payload);
    return NextResponse.json(
      { error: "Korben could not classify, route, or plan the request." },
      { status: 502 }
    );
  }

  const outputText =
    payload.output_text ??
    payload.output
      ?.flatMap((item: any) => item.content ?? [])
      ?.find((item: any) => item.type === "output_text")
      ?.text;

  if (!outputText) {
    return NextResponse.json(
      { error: "Korben returned an empty response." },
      { status: 502 }
    );
  }

  try {
    const parsed = JSON.parse(outputText);
    return NextResponse.json(normalizePlan(parsed, requestText));
  } catch {
    return NextResponse.json(
      { error: "Korben returned invalid structured output." },
      { status: 502 }
    );
  }
}
