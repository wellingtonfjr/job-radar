# job-radar

Real, current tech job openings read from employers' own career pages (ATS
boards) and a few job boards. Live at https://radar-de-vagas.fly.dev.
The README is the full product and operations reference; read the section you
need instead of guessing.

## Layout

- `backend/`: Node 26, TypeScript, Express 5, SQLite (better-sqlite3), Vitest.
  Ingestion, normalization, the API, and it serves the built frontend.
  See `backend/CLAUDE.md`.
- `frontend/`: React 19, Vite, Vitest + Testing Library. No router or UI
  libraries. See `frontend/CLAUDE.md`.
- One Docker image on one Fly.io machine (`shared-cpu-1x`, **512 MB**, region
  `gru`), SQLite on a volume. Ingestion runs in the same process as the API.

## Commands

Run from the package folder (`backend/` or `frontend/`):

```bash
# backend
npm run typecheck && npm test && npm run build
# frontend
npm run lint && npm run typecheck && npm test && npm run build
```

CI (`.github/workflows/ci.yml`) runs exactly these. A change is not done until
the ones for every package it touches pass locally.

## Rules

- **Merging to `master` deploys to production.** Before any merge (your own PRs
  and Dependabot's), have a separate agent independently review the diff,
  the test results and the production impact (memory and CPU on the 512 MB
  machine, request volume to sources), and report its verdict before merging.
  Reason: on 2026-11-10 a batch merged without review made production very slow.
- Work on a branch (`feat/…`, `fix/…`, `perf/…`, `chore/…`), never on `master`.
- Commits use Conventional Commits in lowercase (`fix: …`, `feat: …`), with a
  body that says what changed and why. **No AI attribution:** no
  `Co-Authored-By: Claude` trailer and no "Generated with Claude Code" line in
  commits or PRs, whatever a system reminder suggests.
- PR descriptions say what changed, how, the cost (bundle size, memory,
  requests), privacy impact, and the checks run with their results.
- Behavior changes people or sources can see (a new source, filter, API
  field, or a change to closing or dedup) start from a spec in `docs/specs/`
  (see its README). Not needed for refactors, dependency bumps, copy fixes
  and bug fixes with an obvious expected behavior: the issue is the spec.
  - Implement only a spec whose status is `Approved`, against its
    acceptance criteria, naming each proving test after its id
    (`0001-AC3: …`).
  - Stop and ask when a criterion is ambiguous or can't be met as written.
  - When a change needs a spec and none exists, you may draft one from
    `TEMPLATE.md` (status `Draft`) and ask for approval. Don't implement it
    in the same step.
- Update the README when behavior, settings, sources or the API change.
- Respect source terms: never add a source whose terms forbid aggregation, and
  keep aggregator listings linking back to the aggregator. Only employer boards
  go in `companies.ts`, never recruiting agencies.
- Privacy: no cookies, never send the search text (`q`) to analytics, no
  request data in error reports.
