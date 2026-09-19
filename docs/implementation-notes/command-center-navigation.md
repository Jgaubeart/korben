# Command Center navigation action flow

Repository state inspected: `main` at `38b742f2e64e5ddc7b90029b92c939a648038533`.

## Current request-to-response flow

1. `app/page.tsx` is the client-side Command Center. Typed submissions and final Web Speech API transcripts converge on its `sendMessage` path.
2. The client appends/persists the user message and POSTs the request, recent messages, current project, and available projects to `/api/orchestrate`.
3. `app/api/orchestrate/route.ts` asks the model for a strict `OrchestrationPlan`: intent, execution flag, project target, title/summary, `assistant_reply`, and optional tasks. The current intent enum is only `conversation | question | work | action | approval`; it has no UI/navigation action contract.
4. Back in `app/page.tsx`, non-execution plans display `assistant_reply` immediately. Execution plans create objective/task records and start the run flow; the UI then reports the returned reply/status.
5. Voice mode speaks the same assistant text through `speechSynthesis`. Thus an assistant claim such as “I took you to Tasks” can currently be rendered/spoken without any route transition being performed or observed.

## Canonical Tasks destination

There is no `app/tasks/page.tsx` route in this revision. Tasks are an in-page Command Center view: the primary **Tasks** button executes `setActiveView("work")`, and the `activeView` union/render switch identifies `work` as the task workspace.

Therefore the canonical Tasks destination in the current repository is the root route `/` with client state `activeView = "work"`, not `/tasks`. A future URL route must not be assumed until it exists in the App Router tree.

## Navigation execution and acknowledgement integration point

Navigation is a local UI effect and should not be sent into the objective/task runner. Extend the structured `/api/orchestrate` response with a validated client action (for example `{ type: "navigate", destination: "tasks" }`) rather than relying on prose parsing.

The correct executor is `app/page.tsx` inside `sendMessage`, after a successful orchestration response is decoded but **before** the assistant success message is appended or spoken. Map `tasks` to `setActiveView("work")` (or, if Tasks later becomes a real App Router page, `router.push()` to its repository-verified path).

Result reporting must be client-owned:

1. Dispatch the navigation action.
2. Confirm the destination after React commits—e.g. observe `activeView === "work"` in an effect or await a small navigation-result mechanism keyed by action ID. For URL navigation, confirm the pathname instead.
3. Only then append/persist/speak the success response.
4. On timeout, invalid destination, or mismatch, return a failure/clarification response and never claim success.

This point is authoritative because only the browser owns the current `activeView` state and can verify that the requested destination actually became active; `/api/orchestrate` can classify and propose the action, but cannot truthfully acknowledge its client-side result.
