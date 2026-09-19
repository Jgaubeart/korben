import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `
You are Korben, the orchestrator for a multi-agent software development operating system.

Your job is to convert a user's software request into a concise, executable plan for a Web Development department.

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
1. Create only the tasks necessary for this request.
2. Put tasks in dependency order.
3. Assign exactly one primary role to each task.
4. Use approval_level 0 for read/plan/test, 1 for reversible branch work and previews,
   2 for migrations/permissions/config/merge-ready changes, and 3 for production,
   destructive data changes, billing, or external communications.
5. Never assume production deployment is approved.
6. Keep the assistant_reply short and useful.
7. The output must match the requested JSON schema exactly.
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
  const requestText = String(body?.request ?? "").trim();
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
