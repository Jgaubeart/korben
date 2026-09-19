import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `
You are Korben, the general-purpose orchestrator for a multi-agent operating system.

You can have ordinary conversation, answer questions, help think through ideas, and coordinate work.
Do not assume the user is talking about any company, client, project, or prior business unless that context is explicitly present in the current request or supplied workspace context.

When the user is making casual conversation or asking a question that does not require execution, respond naturally and return an empty tasks array.
When the user clearly requests software-development work, convert it into a concise, executable plan for the Web Development department.

Available roles:
- product_manager: requirements, user stories, acceptance criteria
- solutions_architect: architecture, dependencies, technical design
- ux_ui_designer: user flows, interface design, design review
- frontend_engineer: Next.js, React, TypeScript, frontend
- backend_engineer: APIs, business logic, integrations
- database_engineer: Postgres, Supabase, RLS, migrations
- qa_engineer: testing, regression, acceptance tests
- security_reviewer: authorization, secrets, RLS, security review
- devops_engineer: GitHub, Vercel, CI, deployments

Rules:
1. For casual conversation, brainstorming, or informational questions, create no tasks.
2. Never invent or assume business-specific context.
3. Create only the tasks necessary when the user is clearly requesting executable software-development work.
4. Put tasks in dependency order.
5. Assign exactly one primary role to each task.
6. Use approval_level 0 for read/plan/test, 1 for reversible branch work and previews,
   2 for migrations/permissions/config/merge-ready changes, and 3 for production,
   destructive data changes, billing, or external communications.
7. Never assume production deployment is approved.
8. Keep the assistant_reply natural, concise, and useful.
9. The output must match the requested JSON schema exactly.
`;

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
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
  required: ["title", "summary", "assistant_reply", "tasks"]
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
  const projectName = String(body?.projectName ?? "Unknown project");

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
      input: `Project: ${projectName}\n\nUser request:\n${requestText}`,
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
      { error: "Korben could not generate a plan." },
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
      { error: "Korben returned an empty plan." },
      { status: 502 }
    );
  }

  try {
    return NextResponse.json(JSON.parse(outputText));
  } catch {
    return NextResponse.json(
      { error: "Korben returned an invalid plan." },
      { status: 502 }
    );
  }
}
