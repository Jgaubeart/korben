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

const ordinaryWrite = new Set(["insert", "update"]);
const readActions = new Set(["repo", "file", "branch", "pull_request", "select", "search"]);

export function classifyApproval(action: ProtectedAction, effects: VerifiedEffects): ApprovalLevel {
  if (effects.destructiveDataChange) return 3;
  if (action.tool === "vercel.production") return 3;
  if (action.tool === "github.merge" && effects.productionDeploymentTriggered) return 3;
  if (effects.databaseMigration || effects.rlsOrPermissionChange || effects.protectedConfigurationChange || effects.infrastructureChange) return 2;
  if (action.tool === "github.merge") return 2;
  if (action.tool === "supabase.migration") return 2;
  if (action.tool === "github.pr" && action.action === "create") return 1;
  if (action.tool === "github.write") return 1;
  if (action.tool === "vercel.preview") return 1;
  if (action.tool === "supabase.write" && ordinaryWrite.has(action.action)) return 1;
  if (readActions.has(action.action)) return 0;
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
