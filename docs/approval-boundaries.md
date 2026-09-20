# Approval and deployment boundaries

Approval is computed by deterministic code from the requested tool/action and verified target effects. The effective level is the highest level implied by either. Unknown combinations fail closed at L3.

- L0: reads, search, tests, and planning.
- L1: reversible feature-branch writes, pull-request creation, ordinary scoped data inserts/updates, and preview deployments. Creating a PR with `base=main` is only a proposal and is not a merge.
- L2: merges without a production effect, database migrations, RLS or permission changes, protected configuration, and infrastructure changes. These effects override an apparently ordinary write classification.
- L3: production deployment, destructive data effects, and a merge to the verified production branch when that merge triggers Vercel production. For Korben, that includes merging to `main` when connected to Vercel project `prj_WBhAWe7N7VazzaNdUumb87vdvZdr`.

Before authorization, target facts must be verified from provider state, including repository, PR number and head SHA, base/target branch, Vercel project, and whether the target branch produces a production deployment. Client claims do not reduce the required level.

Each approval stores a SHA-256 binding over a canonical representation of the exact action, parameters, and verified effects. Execution requires approved status, a sufficient level, and an exact binding match. Changing a PR number, head SHA, branch, repository, Vercel project, migration, or other protected target invalidates the approval; unrelated approvals cannot be reused.
