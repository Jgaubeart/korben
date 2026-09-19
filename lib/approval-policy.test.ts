import { strict as assert } from "node:assert";
import { approvalAuthorizes, approvalBinding, classifyApproval } from "./approval-policy.ts";

const merge = { tool: "github.merge", action: "merge", params: { repo: "Jgaubeart/korben", number: 12 } };
const productionEffects = { repository: "Jgaubeart/korben", baseBranch: "main", pullRequestNumber: 12, pullRequestHeadSha: "abc123", vercelProjectId: "prj_WBhAWe7N7VazzaNdUumb87vdvZdr", productionDeploymentTriggered: true };

assert.equal(classifyApproval(merge, productionEffects), 3);
assert.equal(classifyApproval({ tool: "github.pr", action: "create", params: { base: "main" } }, { baseBranch: "main" }), 1);
assert.equal(classifyApproval({ tool: "supabase.write", action: "update", params: {} }, { rlsOrPermissionChange: true }), 2);
assert.equal(classifyApproval({ tool: "github.write", action: "update_file", params: {} }, { protectedConfigurationChange: true }), 2);
assert.equal(classifyApproval({ tool: "github.write", action: "update_file", params: {} }, { infrastructureChange: true }), 2);
assert.equal(classifyApproval({ tool: "supabase.migration", action: "apply", params: {} }, { databaseMigration: true }), 2);

const binding = approvalBinding(merge, productionEffects);
assert.equal(approvalAuthorizes({ level: 3, binding, status: "approved" }, merge, productionEffects), true);
assert.equal(approvalAuthorizes({ level: 2, binding, status: "approved" }, merge, productionEffects), false);
assert.equal(approvalAuthorizes({ level: 3, binding, status: "approved" }, { ...merge, params: { ...merge.params, number: 13 } }, { ...productionEffects, pullRequestNumber: 13 }), false);
