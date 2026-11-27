# 0001 Teamtailor source

- **Status:** Draft
- **Issue:** #66 (Recruitee, the first ATS in it, already shipped)
- **Owner:** @wellingtonfjr

## Problem

Many European and startup employers hire through Teamtailor. Today their
roles only reach job-radar through job boards, which means:
"Apply" leads to the board instead of the employer, closing depends on the
board's partial feed, and roles the boards don't carry are missing. A
Teamtailor link inside a description is already recognized as a direct
posting (`backend/src/resolve/postingUrls.ts`), but we never read
Teamtailor boards themselves.

## Goals

- Read each listed company's Teamtailor board in full, twice a day, like
  the other ATS sources: complete feed, direct apply, accurate closing.
- A seed list of companies in `companies.ts`, employer boards only.

## Non-goals

- **Discovery** of Teamtailor boards by company name
  (`backend/src/resolve/atsDiscovery.ts`). Follow-up spec, once the curated
  list shows the source is worth it.
- **Accuracy verifier** for Teamtailor postings
  (`backend/src/accuracy/verify.ts`). Follow-up; until then Teamtailor roles
  are drawn by the audit and count as `unknown`, never as open (as Workable
  and Recruitee today).
- **Fetching from custom career domains** (`careers.company.com` hosted by
  Teamtailor). Only boards at `{token}.teamtailor.com` are read. The
  posting links those boards publish are used as they are (see 0001-AC1),
  even when they point to the company's own domain.
- Personio, the third ATS in #66.

## Design

- `backend/src/sources/teamtailor.ts`: a `SourceAdapter` with
  `kind: "ats"`, built on `fetchBoards` and `withDiscovered` from
  `boards.ts`, like `workable.ts` and `recruitee.ts`. Fetch and map to
  `RawJob` only: no category filtering in the adapter (the pipeline drops
  non-tech roles), normalization stays in `normalize/`.
  - `feeds: TEAMTAILOR_BOARDS.map((b) => b.token)`. The pipeline uses it to
    close the roles of a board removed from the list and to look up
    discovered boards.
  - `withDiscovered` adds nothing today (no Teamtailor discovery
    provider). It's used so the discovery follow-up needs no adapter change.
  - `minIntervalMinutes: 60`, same as Workable and Recruitee.
- Endpoint per company: `https://{token}.teamtailor.com/jobs.rss`
  (checked Oct 28, 2026 on a sample site: 16 items). The feed is XML, so the
  adapter needs a small, dependency-free RSS item parser that handles CDATA
  and decodes entities (`decodeEntities` in `normalize/html.ts`).
- HTTP: `getText` in `sources/http.ts` gains `accept` and `retries`
  options with the same retry rule as `getJson` (one retry on network
  errors, 5xx and 429). The adapter asks for
  `application/rss+xml, application/xml` with one retry. Existing
  `getText` callers keep today's behavior (defaults unchanged).
- `TEAMTAILOR_BOARDS: CompanyBoard[]` in `companies.ts`.
- Registered in `sources/index.ts` with the other ATS sources.
  `kind: "ats"` is what makes its copy win de-duplication over job boards
  (`SOURCE_RANK` in `ingestion/pipeline.ts`). Between two ATS copies, the
  source id decides, alphabetically.

## Acceptance criteria

Ids are prefixed with the spec number; tests are named after them
(`it("0001-AC3: …")`).

- **0001-AC1.** Given a board's RSS with N valid items, when the source
  runs, then it yields one `complete: true` feed for that board with N
  jobs (through `context.emit` when given, otherwise in `results`), each
  with:
  - `externalId`: the numeric id in the posting link's path
    (`/jobs/{id}-…`);
  - `title`;
  - `company`: the name in `companies.ts`;
  - `url`: the item's link, as published;
  - `postedAt`: the item's date, when it has one.
- **0001-AC2.** Given an item, when it's mapped, then:
  - `locations` holds its location text;
  - `workplace` is `remote` only when the feed says so explicitly, `null`
    otherwise (inferred later from text);
  - its department, if the feed has one, goes to `tags` and
    `categoryHints`;
  - its employment type, if any, goes to `employmentTypeHints`;
  - its description goes to `descriptionHtml`.
- **0001-AC3.** Given an item whose title and description come in CDATA or
  entity-encoded (`R&amp;D`, `&lt;p&gt;`), when it's mapped, then `title`
  is plain decoded text (`R&D`) and `descriptionHtml` is the decoded HTML.
- **0001-AC4.** Given a stored role missing from the next complete read of
  its board, and the board still lists at least half of its open roles,
  when that run finishes, then the role is closed.
- **0001-AC5.** Given a board with 10 or more open roles that suddenly
  lists fewer than half of them, when the source runs, then nothing is
  closed for that board (drop guard in `ingestion/pipeline.ts`).
- **0001-AC6.** Given a stored role whose board token was removed from
  `TEAMTAILOR_BOARDS`, when the source runs and writes at least one job
  from its other boards, then that role is closed (the pipeline skips this
  when a run wrote nothing, so an outage can't close everything).
- **0001-AC7.** Given a board that answers 404 or 410, when the source
  runs, then that feed is reported as `gone`, nothing is closed because of
  the failure, and the other boards are processed normally.
- **0001-AC8.** Given a board that answers 503 and then 200, when the
  source runs, then the board is read normally. Given a board that keeps
  failing (timeouts or 5xx), then its stored roles stay open and the error
  is reported for that feed only.
- **0001-AC9.** Given malformed XML, or an item without a link, a title or
  a numeric id in its link, when it's parsed, then that item is skipped,
  the rest of the board is kept, and no exception escapes the adapter.
- **0001-AC10.** Given a non-tech item (for example "Account Executive"),
  when it's ingested, then it isn't stored and it doesn't make the board
  look shrunk to the drop guard. The adapter sets no `skipped`, since it
  filters nothing itself.
- **0001-AC11.** Given a role on Teamtailor that also appears on a job
  board, when both are ingested, then the listing shows the Teamtailor
  copy and "Apply" goes to the Teamtailor posting.
- **0001-AC12.** Given the seed list, when
  `npm run ingest -- --force teamtailor` runs locally, then every board is
  read without errors, and `/api/stats` lists `teamtailor` with a
  successful last run and at least one open role.
  **[post-deploy]** the same holds on production after the first
  scheduled run.
- **0001-AC13.** The README sources table has a Teamtailor row (kind,
  scope, minimum interval), and "Adding a company" names the Teamtailor
  URL form.

## Constraints

- **Memory:** boards stream through `context.emit` like the other ATS
  sources; never hold every board at once. Parse items one by one; no XML
  library that builds a full DOM of every feed in memory.
- **Requests:** one request per board per run (plus at most one retry), at
  most `BOARD_CONCURRENCY` (4) at a time, through the shared helpers in
  `sources/http.ts` (timeout and User-Agent).
- **Terms:** only boards published by the employer itself; no recruiting
  agencies in the seed list.
- **No new runtime dependency** unless the PR justifies it.

## Risks and rollback

- *The RSS feed may not list every open role* (paging, a cap). Then
  `complete: true` would close roles that are still open. This is the main
  risk, and why open question 1 must be answered first.
- *Description quality:* if the feed carries only a summary, salary and
  skill extraction get less to work with. Acceptable, but noted in the PR.
- *Rollback:* remove the source from `sources/index.ts`; its open roles
  close at the next cycle (`retireRemovedSources`).

## Open questions

- [ ] **1. Is `jobs.rss` complete?** Compare the item count with the roles
      on the career page for 3 boards of different sizes, including one with
      more than 50 roles. If it's capped, find the paging parameter or stop:
      a partial feed can't be `complete: true`.
- [ ] **2. What does an item carry?** Full description or summary;
      location, remote/hybrid, department, employment type; the link's
      form (always `/jobs/{id}-…`?) and domain. This confirms 0001-AC1 and
      0001-AC2 or changes them before approval.
- [ ] **3. Seed list:** 5 to 10 tech employers whose own board is
      `{company}.teamtailor.com`, each checked by hand.
- [ ] **4. Rate limits or bot protection** on the feed at one request per
      board twice a day.

## Verification

Filled in by the implementing PR; post-deploy rows after the first
production run.

| AC | Proved by |
| --- | --- |
| 0001-AC1 | |
| 0001-AC2 | |
| 0001-AC3 | |
| 0001-AC4 | |
| 0001-AC5 | |
| 0001-AC6 | |
| 0001-AC7 | |
| 0001-AC8 | |
| 0001-AC9 | |
| 0001-AC10 | |
| 0001-AC11 | |
| 0001-AC12 | |
| 0001-AC12 [post-deploy] | |
| 0001-AC13 | |
