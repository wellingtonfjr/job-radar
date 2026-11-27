# frontend

## Map

- `src/api/`: API client and types (keep in sync with the backend responses).
- `src/components/`, `src/pages/`, `src/hooks/`: UI. Plain React and CSS
  (`index.css`), no UI library.
- `src/lib/router.ts`: our own tiny History-API router with three routes:
  the list `/`, the role page `/jobs/:id` (build it with `jobPath()`) and
  `/saved`. Separately, the role selected for the list + preview split is the
  `?job=…` query param (`src/lib/filters.ts`). A link to a role needs the
  right one of the two. Don't add a router library.
- `src/i18n/`: every user-visible string lives in `en.ts` and `pt-BR.ts`. Add
  both when you add text.
- `src/lib/analytics.ts`: PostHog. Only the events listed in the README, no
  autocapture, and `q` stripped from URLs.
- Saved and applied roles live in `localStorage` (`savedRoles.ts`); there are no
  accounts.

## Rules

- No new runtime dependency without a reason in the PR and its bundle cost
  (gzip). Lazy-load anything that isn't needed for the first render.
- Layouts work from phone width up: the filters are a full-screen sheet on
  phones, and list + preview split on wide screens.
- Tests: Vitest + Testing Library, in `frontend/test/`.
  `npm run lint && npm run typecheck && npm test && npm run build` before
  calling a change done.
