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
- approval: a requested action that is L2/L3 and therefore requires explicit approval before execution

Project routing rules:
1. Return target_project_slug for work/action/approval when the target can be resolved from the request or current context.
2. If the user explicitly names a project, business, app, repository, or workspace that matches an available project, route to that project automatically.
3. Examples: "Korben OS", "KorbenOS", "Korben" when clearly referring to building the product -> korben-os. "Cabinet Genies Portal" -> cabinet-genies-portal.
4. The current project can be used when it is already execution-scoped and the request clearly continues that work.
5. General Workspace is conversational and neutral. Do not route external execution to general-workspace.
6. If execution is requested but no available target project can be resolved confidently, return target_project_slug="" and explain briefly that Korben needs the target named. Do not invent a project.
7. conversation and question may use target_project_slug="" unless project context is materially useful.

Execution rules:
1. conversation and question must return requires_execution=false and an empty tasks array.
2. work, action, and approval may create tasks only when useful.
3. Never invent or assume business-specific context.
4. Put tasks in dependency order.
5. Assign exactly one primary role to each task.
6. Use approval_level 0 for read/plan/test, 1 for reversible branch work and previews,
   2 for migrations/permissions/config/merge-ready changes, and 3 for production,
   destructive data changes, billing, or external communications.
7. If the user's requested action is approval level 2 or 3, classify intent as approval.
8. Never assume production deployment is approved.
9. Keep assistant_reply natural, concise, and useful.
10. The output must match the requested JSON schema exactly.

Available roles:
- product_manager
- solutions_architect
- ux_ui_designer
- frontend_engineer
- backend_engineer
- database_engineer
- qa_engineer
- security_reviewer
- devops_engineer
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
    "tasks"
  ]
};

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
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_ORCHESTRATOR_MODEL || "gpt-5.6-sol",
      reasoning: { effort: "medium" },
      instructions: SYSTEM_PROMPT,
      input: [
        `Current Command Center context: ${currentProjectName} (${currentProjectSlug})`,
        `Available projects: ${JSON.stringify(availableProjects)}`,
        "",
        "User request:",
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
    return NextResponse.json(JSON.parse(outputText));
  } catch {
    return NextResponse.json(
      { error: "Korben returned invalid structured output." },
      { status: 502 }
    );
  }
}
