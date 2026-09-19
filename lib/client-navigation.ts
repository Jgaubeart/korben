export type ClientView =
  | "command"
  | "network"
  | "work"
  | "runs"
  | "brain"
  | "sops"
  | "tools"
  | "integrations"
  | "focus"
  | "preflight";

export type NavigationDestination = "tasks";

export type NavigationAction = {
  type: "navigate";
  destination: NavigationDestination;
};

export type NavigationTarget = {
  label: string;
  route: string;
  view: ClientView;
};

export const NAVIGATION_DESTINATIONS: Record<
  NavigationDestination,
  NavigationTarget
> = {
  tasks: {
    label: "Tasks",
    route: "/",
    view: "work",
  },
};

export function isNavigationAction(value: unknown): value is NavigationAction {
  if (!value || typeof value !== "object") return false;

  const action = value as { type?: unknown; destination?: unknown };
  return (
    action.type === "navigate" &&
    typeof action.destination === "string" &&
    action.destination in NAVIGATION_DESTINATIONS
  );
}

export function navigationFailureMessage(destination?: string) {
  const requested = destination ? ` "${destination}"` : "";
  return `I couldn't navigate to${requested}. Please use the Tasks button in the sidebar to navigate manually.`;
}
