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


const productionMerge = {
  tool: "github.merge",
  action: "merge",
  params: { repo: "Jgaubeart/korben", number: 2, merge_method: "squash" },
};
const productionMergeEffects = {
  repository: "Jgaubeart/korben",
  baseBranch: "main",
  targetBranch: "main",
  pullRequestNumber: 2,
  pullRequestHeadSha: "head-a",
  vercelProjectId: "prj_WBhAWe7N7VazzaNdUumb87vdvZdr",
  productionDeploymentTriggered: true,
};
const productionBinding = approvalBinding(productionMerge, productionMergeEffects);

assert.equal(classifyApproval({ tool: "github.read", action: "workflow_runs", params: {} }, {}), 0);
assert.equal(classifyApproval({ tool: "github.write", action: "sync_branch", params: { branch: "feature/x", source: "main" } }, { targetBranch: "feature/x" }), 1);
assert.equal(classifyApproval({ tool: "github.merge", action: "merge", params: { number: 2 } }, { baseBranch: "develop", productionDeploymentTriggered: false }), 2);
assert.equal(classifyApproval(productionMerge, productionMergeEffects), 3);
assert.equal(classifyApproval({ tool: "future.tool", action: "search", params: {} }, {}), 3);
assert.equal(approvalAuthorizes({ level: 3, binding: productionBinding, status: "pending" }, productionMerge, productionMergeEffects), false);
assert.equal(
  approvalAuthorizes(
    { level: 3, binding: productionBinding, status: "approved" },
    productionMerge,
    { ...productionMergeEffects, pullRequestHeadSha: "head-b" }
  ),
  false
);
assert.equal(
  approvalAuthorizes(
    { level: 3, binding: productionBinding, status: "approved" },
    { ...productionMerge, params: { ...productionMerge.params, number: 3 } },
    { ...productionMergeEffects, pullRequestNumber: 3 }
  ),
  false
);
assert.equal(
  approvalBinding(
    { tool: "github.merge", action: "merge", params: { b: 2, a: 1 } },
    { repository: "Jgaubeart/korben", targetBranch: undefined }
  ),
  approvalBinding(
    { tool: "github.merge", action: "merge", params: { a: 1, b: 2 } },
    { repository: "Jgaubeart/korben" }
  )
);
