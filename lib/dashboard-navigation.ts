export const DASHBOARD_DESTINATIONS = [
  { view: "command", label: "Home", aliases: ["home", "home page", "dashboard", "overview"] },
  { view: "work", label: "Tasks", aliases: ["task", "tasks", "task page", "missions", "mission control"] },
  { view: "workstream", label: "Delegation", aliases: ["delegation", "delegation feed", "workstream", "agent activity"] },
  { view: "network", label: "Agents", aliases: ["agent", "agents", "agent network", "network"] },
  { view: "runs", label: "Runs", aliases: ["run", "runs", "task runs", "run history", "activity log", "execution history"] },
  { view: "focus", label: "Focus", aliases: ["focus", "focus mode"] },
  { view: "brain", label: "Library", aliases: ["knowledge", "library", "brain"] },
  { view: "sops", label: "SOPs", aliases: ["sop", "sops", "standard operating procedure", "standard operating procedures"] },
  { view: "tools", label: "Tools", aliases: ["tool", "tools", "tool registry"] },
  { view: "integrations", label: "Integrations", aliases: ["integration", "integrations", "settings"] },
  { view: "preflight", label: "Preflight", aliases: ["preflight", "system check", "health check"] },
] as const;

export type KorbenView = (typeof DASHBOARD_DESTINATIONS)[number]["view"];
export type DashboardDestination = (typeof DASHBOARD_DESTINATIONS)[number];

export type DashboardNavigationResult =
  | { kind: "navigate"; destination: DashboardDestination }
  | { kind: "clarify"; message: string; suggestions: DashboardDestination[] }
  | { kind: "not_navigation" };

const NAVIGATION_VERB = /\b(open|show|go to|navigate to|take me to|switch to|view|bring up|pull up)\b/i;

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/\bkorben\b/g, " ")
    .replace(/\bplease\b/g, " ")
    .replace(/[?.!,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const destinationMatches = (request: string, destination: DashboardDestination) =>
  destination.aliases.some((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(request));

export const resolveDashboardNavigation = (value: string): DashboardNavigationResult => {
  const normalized = normalize(value);
  if (!NAVIGATION_VERB.test(normalized)) return { kind: "not_navigation" };

  const matches = DASHBOARD_DESTINATIONS.filter((destination) => destinationMatches(normalized, destination));
  if (matches.length === 1) return { kind: "navigate", destination: matches[0] };

  if (matches.length > 1) {
    return {
      kind: "clarify",
      message: `Did you mean ${matches.map((item) => item.label).join(" or ")}?`,
      suggestions: matches,
    };
  }

  return {
    kind: "clarify",
    message: `I can’t find that dashboard destination. Try ${DASHBOARD_DESTINATIONS.map((item) => item.label).join(", ")}.`,
    suggestions: [...DASHBOARD_DESTINATIONS],
  };
};
