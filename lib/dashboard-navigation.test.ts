import { strict as assert } from "node:assert";
import { resolveDashboardNavigation } from "./dashboard-navigation.ts";

assert.deepEqual(resolveDashboardNavigation("Open the Tasks page"), {
  kind: "navigate",
  destination: { view: "work", label: "Tasks", aliases: ["task", "tasks", "task page", "missions", "mission control"] },
});
assert.equal(resolveDashboardNavigation("Korben, take me to settings").kind, "navigate");
assert.equal(resolveDashboardNavigation("What tasks are overdue?").kind, "not_navigation");

const ambiguous = resolveDashboardNavigation("Open Tasks or Task Runs");
assert.equal(ambiguous.kind, "clarify");
if (ambiguous.kind === "clarify") {
  assert.equal(ambiguous.message, "Did you mean Tasks or Runs?");
}

const unknown = resolveDashboardNavigation("Navigate to Reports");
assert.equal(unknown.kind, "clarify");
if (unknown.kind === "clarify") {
  assert.match(unknown.message, /can’t find/);
}
