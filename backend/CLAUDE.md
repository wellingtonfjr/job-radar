# backend

## Map

- `src/sources/`: one adapter per source, **fetch and map only** (to `RawJob`).
  Register it in `src/sources/index.ts`, ATS sources before job boards (order
  decides which copy wins de-duplication). Curated boards are in
  `companies.ts`.
- `src/normalize/`: category (tech only, `classify.ts`), seniority, salary,
  location to ISO countries, skills, dedup keys. Pure functions.
- `src/ingestion/`: pipeline (upsert, close, retire, dedup, pay bands),
  scheduler, CLI (`npm run ingest -- --force <source>`).
- `src/resolve/`: finds the employer's own posting for job-board listings.
- `src/accuracy/`: weekly audit and hourly liveness checks against the ATS.
- `src/api/`: Express routes. `src/errors.ts`: `reportError()`.

## Invariants (easy to break)

- Only a feed with `complete: true` may close jobs missing from it. Paged or
  capped feeds return `complete: false`.
- Drop guard: a feed that suddenly lists under half of its open jobs is a
  glitch and closes nothing. Filtered-out jobs count via `skipped`.
- Memory: ingestion streams boards and writes as it goes. Don't load every
  job or every description into memory at once. Descriptions live in their own
  table, outside `jobs`.
- Be polite to sources: respect each adapter's `minIntervalMinutes`, pause
  between pages, cap requests per run.
- Report only unexpected failures through `reportError`. A few failing
  boards in a run are routine.

## Tests

- Vitest in `test/`, one file per area. Use `rawJob()` and `fakeSource()` from
  `test/helpers.ts`. Never hit the network in tests: inject a fake fetcher
  (as `createGetOnBrdSource` takes `fetchPage`) or stub `fetch` with
  `vi.stubGlobal`.
- A new adapter gets a test with sample responses and an ingestion run over
  them, like `test/getonbrd.test.ts`.
- `npm run typecheck && npm test` before calling a change done.
