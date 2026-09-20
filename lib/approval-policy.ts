import { createHash } from "node:crypto";

export type ApprovalLevel = 0 | 1 | 2 | 3;
export type ProtectedAction = { tool: string; action: string; params: Record<string, unknown> };
export type VerifiedEffects = {
  repository?: string;
  baseBranch?: string;
  targetBranch?: string;
  pullRequestNumber?: number;
  pullRequestHeadSha?: string;
  vercelProjectId?: string;
  productionDeploymentTriggered?: boolean;
  databaseMigration?: boolean;
  rlsOrPermissionChange?: boolean;
  protectedConfigurationChange?: boolean;
  infrastructureChange?: boolean;
  destructiveDataChange?: boolean;
};

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const readPairs = new Set([
  "github.read:repo",
  "github.read:file",
  "github.read:branch",
  "github.read:branches",
  "github.read:pull_request",
  "github.read:pull_requests",
  "github.read:commit",
  "github.read:compare",
  "github.read:workflow_runs",
  "github.read:workflow_run",
  "github.read:workflow_jobs",
  "vercel.read:project",
  "vercel.read:deployments",
  "vercel.read:deployment",
  "supabase.read:select",
  "knowledge.search:search",
  "browser.inspect:inspect",
]);

const l1Pairs = new Set([
  "github.write:create_branch",
  "github.write:update_file",
  "github.write:replace_text",
  "github.write:sync_branch",
  "github.pr:create",
  "vercel.preview:deploy",
  "supabase.write:insert",
  "supabase.write:update",
]);

export function classifyApproval(action: ProtectedAction, effects: VerifiedEffects): ApprovalLevel {
  if (effects.destructiveDataChange) return 3;
  if (action.tool === "vercel.production") return 3;
  if (action.tool === "github.merge" && effects.productionDeploymentTriggered) return 3;

  if (
    effects.databaseMigration ||
    effects.rlsOrPermissionChange ||
    effects.protectedConfigurationChange ||
    effects.infrastructureChange
  ) return 2;

  if (action.tool === "github.merge" && action.action === "merge") return 2;
  if (action.tool === "supabase.migration") return 2;

  const pair = action.tool + ":" + action.action;
  if (l1Pairs.has(pair)) return 1;
  if (readPairs.has(pair)) return 0;

  return 3;
}

export function approvalBinding(action: ProtectedAction, effects: VerifiedEffects): string {
  return createHash("sha256")
    .update(stable({ version: 1, action, effects }))
    .digest("hex");
}

export function approvalAuthorizes(
  approval: { level: ApprovalLevel; binding: string; status: string },
  action: ProtectedAction,
  effects: VerifiedEffects
): boolean {
  const required = classifyApproval(action, effects);
  const binding = approvalBinding(action, effects);
  return approval.status === "approved" && approval.level >= required && approval.binding === binding;
}
