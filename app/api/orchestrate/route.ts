import { NextResponse } from "next/server";

import {
  NAVIGATION_DESTINATIONS,
  type NavigationDestination,
} from "../../../lib/client-navigation";

const SYSTEM_PROMPT = `
You are Korben, the general-purpose orchestrator for a multi-agent operating system.

You can have ordinary conversation, answer questions, coordinate work, identify external actions, and request local Command Center navigation.

Classify every request into exactly one intent: conversation, question, work, action, or approval.

Navigation rules:
1. When the current request asks to open, show, go to, or take the user to a recognized Command Center destination, return client_action={"type":"navigate","destination":"tasks"}.
2. The recognized destination is Tasks (including task page, tasks page, work, or work queue).
3. Navigation is a local client action: requires_execution=false and tasks=[].
4. Never claim navigation succeeded in assistant_reply. The browser owns execution and confirmation. Use neutral wording such as "Opening Tasks."
5. For an unavailable or unclear destination, return client_action=null and clearly say that navigation is unavailable and the user should use the sidebar manually.
6. Never invent a destination.

Project routing rules:
1. Return target_project_slug for work/action/approval when the target can be resolved from the request or current context.
2. If the user names a project that matches an available project, route to it automatically.
3. General Workspace is neutral. Do not route external execution to general-workspace.
4. If execution is requested but no target project can be resolved, use an empty target_project_slug and ask for the target.
5. Recent conversation only resolves follow-ups; the newest request controls intent and scope.
6. Prior conversation never grants fresh L2/L3 approval.

Execution rules:
1. conversation and question use requires_execution=false and tasks=[].
2. work, action, and approval may create tasks only when useful.
3. Preserve every explicit execution step requested.
4. Put tasks in dependency order and assign exactly one primary role.
5. approval_level 0: read/plan/test.
6. approval_level 1: reversible feature-branch edits, commits, PRs, preview deployments.
7. approval_level 2: merges, migrations, RLS/permissions, protected configuration, infrastructure.
8. approval_level 3: production deployment, destructive data, billing, broad permissions, external/customer sends.
9. Never assume production deployment is approved.
10. Keep assistant_reply concise and useful.
11. Output must match the requested JSON schema exactly.

Available roles: product_manager, solutions_architect, ux_ui_designer, frontend_engineer, backend_engineer, database_engineer, qa_engineer, security_reviewer, devops_engineer.
`;

const CLIENT_ACTION_SCHEMA = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["navigate"] },
        destination: {
          type: "string",
          enum: Object.keys(NAVIGATION_DESTINATIONS),
        },
      },
      required: ["type", "destination"],
    },
  ],
};

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: ["conversation", "question", "work", "action", "approval"],
    },
    requires_execution: { type: "boolean" },
    target_project_slug: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    assistant_reply: { type: "string" },
    client_action: CLIENT_ACTION_SCHEMA,
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
              "devops_engineer",
            ],
          },
          acceptance_criteria: { type: "array", items: { type: "string" } },
          approval_level: { type: "integer", minimum: 0, maximum: 3 },
        },
        required: [
          "title",
          "description",
          "agent_system_key",
          "acceptance_criteria",
          "approval_level",
        ],
      },
    },
  },
  required: [
    "intent",
    "requires_execution",
    "target_project_slug",
    "title",
    "summary",
    "assistant_reply",
    "client_action",
    "tasks",
  ],
};

function normalizeClientAction(value: unknown) {
  if (!value || typeof value !== "object") return null;

  const action = value as { type?: unknown; destination?: unknown };
  if (action.type !== "navigate" || typeof action.destination !== "string") {
    return null;
  }

  if (!(action.destination in NAVIGATION_DESTINATIONS)) return null;

  return {
    type: "navigate" as const,
    destination: action.destination as NavigationDestination,
  };
}

function normalizePlan(plan: any, requestText: string) {
  const explicitNoMerge = /\b(do not|don't|never)\s+merge\b/i.test(requestText);
  const explicitNoProduction =
    /\b(do not|don't|never)\s+(deploy|ship|release).*(production|prod)\b/i.test(requestText) ||
    /\b(do not|don't|never)\s+deploy\s+to\s+production\b/i.test(requestText);

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
            !/\b(production|prod)\b/.test(text);
          const needsVercelRead =
            /\b(vercel|deployment|deployments|production branch|preview)\b/.test(text) &&
            /\b(audit|inspect|verify|check|determine|review|read|trace)\b/.test(text);

          const normalizedAgent =
            needsVercelRead && task?.agent_system_key === "solutions_architect"
              ? "devops_engineer"
              : task?.agent_system_key;

          return {
            ...task,
            agent_system_key: normalizedAgent,
            approval_level:
              isPullRequestCreation || isPreview
                ? Math.min(Number(task.approval_level ?? 1), 1)
                : task.approval_level,
          };
        })
    : [];

  const clientAction = normalizeClientAction(plan?.client_action);
  if (clientAction) {
    return {
      ...plan,
      client_action: clientAction,
      intent: "conversation",
      requires_execution: false,
      tasks: [],
    };
  }

  const maxApproval = tasks.reduce(
    (max: number, task: any) => Math.max(max, Number(task?.approval_level ?? 0)),
    0
  );

  return {
    ...plan,
    client_action: null,
    tasks,
    intent: plan?.intent === "approval" && maxApproval < 2 ? "action" : plan?.intent,
    requires_execution: ["work", "action", "approval"].includes(
      plan?.intent === "approval" && maxApproval < 2 ? "action" : plan?.intent
    )
      ? Boolean(plan?.requires_execution ?? true)
      : false,
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });
  }

  const body = await request.json();
  const requestText = String(body?.request ?? "").trim().replace(/\bcorbin\b/gi, "Korben");
  const currentProjectName = String(body?.projectName ?? "General Workspace");
  const currentProjectSlug = String(body?.currentProjectSlug ?? "general-workspace");
  const recentMessages = Array.isArray(body?.recentMessages)
    ? body.recentMessages.slice(-12).map((message: any) => ({
        role: message?.role === "assistant" ? "assistant" : "user",
        content: String(message?.content ?? "").slice(0, 4000),
      }))
    : [];
  const availableProjects = Array.isArray(body?.projects)
    ? body.projects
        .map((project: any) => ({
          name: String(project?.name ?? ""),
          slug: String(project?.slug ?? ""),
          has_github: Boolean(project?.github_repo),
          has_vercel: Boolean(project?.vercel_project_id),
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
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_ORCHESTRATOR_MODEL || "gpt-5.6-sol",
      reasoning: { effort: "medium" },
      instructions: SYSTEM_PROMPT,
      input: [
        `Current Command Center context: ${currentProjectName} (${currentProjectSlug})`,
        `Available projects: ${JSON.stringify(availableProjects)}`,
        `Recent conversation context: ${JSON.stringify(recentMessages)}`,
        "",
        "Current user request:",
        requestText,
      ].join("\n"),
      text: {
        format: {
          type: "json_schema",
          name: "korben_execution_plan",
          strict: true,
          schema: PLAN_SCHEMA,
        },
      },
    }),
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
    return NextResponse.json({ error: "Korben returned an empty response." }, { status: 502 });
  }

  try {
    return NextResponse.json(normalizePlan(JSON.parse(outputText), requestText));
  } catch {
    return NextResponse.json(
      { error: "Korben returned invalid structured output." },
      { status: 502 }
    );
  }
}
