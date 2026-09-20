import { NextResponse } from "next/server";
import { createLocalizedTimeContext } from "../../../lib/localized-time";

const SYSTEM_PROMPT = `
You are Korben, the general-purpose orchestrator for a multi-agent operating system.

Classify every request into exactly one intent: conversation, question, work, action, or approval.
Conversation and question requests never execute tools and must return an empty tasks array. Work, action, and approval may create tasks when useful. Never invent business context or a project.

Trusted-time rules:
- Temporal context marked trusted is captured from the server clock for this request. Use it for current date/time questions; never answer from model knowledge.
- A valid IANA time zone is formatted by the server and automatically includes daylight-saving rules.
- Cape Coral uses America/New_York.
- If temporal status is missing_time_zone or invalid_time_zone, give the trusted UTC time and clearly ask for a valid IANA time zone. Never invent local time.
- Time questions are question intent, require no execution, and have no tasks.

Project routing rules:
1. Return target_project_slug for work/action/approval only when resolvable from the request, current context, or available projects.
2. General Workspace is neutral and must not receive external execution.
3. If execution is requested but no target resolves, return an empty target_project_slug and explain briefly.
4. Recent messages only resolve follow-ups; the newest request controls intent and scope. Prior context never grants approval.

Execution and response rules:
1. conversation and question: requires_execution=false and tasks=[].
2. Preserve every explicitly requested execution step in dependency order.
3. Assign one primary role per task.
4. approval_level: 0 read/plan/test; 1 reversible feature-branch edits, PRs, previews; 2 merge, migration, permissions/config/infrastructure; 3 production, destructive data, billing, or external sends.
5. A PR to main is L1 and is not a merge. Never assume production approval.
6. assistant_reply must be plain, conversational English, at most 45 words unless detail is requested. Do not expose code, JSON, paths, SHAs, tool names, approval levels, or internal planning unless asked.
7. Output must match the requested JSON schema exactly.

Available roles: product_manager, solutions_architect, ux_ui_designer, frontend_engineer, backend_engineer, database_engineer, qa_engineer, security_reviewer, devops_engineer.
`;

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ["conversation", "question", "work", "action", "approval"] },
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
          agent_system_key: { type: "string", enum: ["product_manager", "solutions_architect", "ux_ui_designer", "frontend_engineer", "backend_engineer", "database_engineer", "qa_engineer", "security_reviewer", "devops_engineer"] },
          acceptance_criteria: { type: "array", items: { type: "string" } },
          approval_level: { type: "integer", minimum: 0, maximum: 3 }
        },
        required: ["title", "description", "agent_system_key", "acceptance_criteria", "approval_level"]
      }
    }
  },
  required: ["intent", "requires_execution", "target_project_slug", "title", "summary", "assistant_reply", "tasks"]
};

function normalizePlan(plan: any) {
  const passive = plan?.intent === "conversation" || plan?.intent === "question";
  return {
    ...plan,
    requires_execution: passive ? false : Boolean(plan?.requires_execution ?? true),
    tasks: passive ? [] : Array.isArray(plan?.tasks) ? plan.tasks : [],
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });

  const body = await request.json();
  const requestText = String(body?.request ?? "").trim().replace(/\bcorbin\b/gi, "Korben");
  if (!requestText) return NextResponse.json({ error: "Request is required." }, { status: 400 });

  const currentProjectName = String(body?.projectName ?? "General Workspace");
  const currentProjectSlug = String(body?.currentProjectSlug ?? "general-workspace");
  const recentMessages = Array.isArray(body?.recentMessages)
    ? body.recentMessages.slice(-12).map((message: any) => ({
        role: message?.role === "assistant" ? "assistant" : "user",
        content: String(message?.content ?? "").slice(0, 4000),
      }))
    : [];
  const availableProjects = Array.isArray(body?.projects)
    ? body.projects.map((project: any) => ({
        name: String(project?.name ?? ""),
        slug: String(project?.slug ?? ""),
        has_github: Boolean(project?.github_repo),
        has_vercel: Boolean(project?.vercel_project_id),
      })).filter((project: any) => project.name && project.slug)
    : [];

  // Capture exactly one authoritative server instant for this request. Browser input supplies only an IANA zone.
  const temporalContext = createLocalizedTimeContext(new Date(), body?.timeZone);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_ORCHESTRATOR_MODEL || "gpt-5.6-sol",
      reasoning: { effort: "medium" },
      instructions: SYSTEM_PROMPT,
      input: [
        `Current Command Center context: ${currentProjectName} (${currentProjectSlug})`,
        `Available projects: ${JSON.stringify(availableProjects)}`,
        `Recent conversation context: ${JSON.stringify(recentMessages)}`,
        `Trusted temporal context: ${JSON.stringify(temporalContext)}`,
        "",
        "Current user request:",
        requestText,
      ].join("\n"),
      text: { format: { type: "json_schema", name: "korben_execution_plan", strict: true, schema: PLAN_SCHEMA } }
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    console.error("OpenAI orchestration error", payload);
    return NextResponse.json({ error: "Korben could not classify, route, or plan the request." }, { status: 502 });
  }

  const outputText = payload.output_text ?? payload.output?.flatMap((item: any) => item.content ?? []).find((item: any) => item.type === "output_text")?.text;
  if (!outputText) return NextResponse.json({ error: "Korben returned an empty response." }, { status: 502 });

  try {
    return NextResponse.json(normalizePlan(JSON.parse(outputText)));
  } catch {
    return NextResponse.json({ error: "Korben returned invalid structured output." }, { status: 502 });
  }
}
