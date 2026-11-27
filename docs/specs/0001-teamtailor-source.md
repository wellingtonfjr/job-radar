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
  count as `unknown` in the audit, never as open.
- **Custom career domains** (`careers.company.com` hosted by Teamtailor).
  Only `{company}.teamtailor.com` in this version.
- Personio, the third ATS in #66.

## Design

- `backend/src/sources/teamtailor.ts`: a `SourceAdapter` with
  `kind: "ats"`, built on `fetchBoards` and `withDiscovered` from
  `boards.ts`, like `workable.ts` and `recruitee.ts`. Fetch and map to
  `RawJob` only; normalization stays in `normalize/`.
- Endpoint per company: `https://{token}.teamtailor.com/jobs.rss`
  (checked Oct 28, 2026 on a sample site: 16 items). The feed is XML, so the
  adapter needs a small, dependency-free RSS item parser.
- `TEAMTAILOR_BOARDS: CompanyBoard[]` in `companies.ts`.
- Registered in `sources/index.ts` with the other ATS sources, before the
  job boards, so its copy wins de-duplication.
- `minIntervalMinutes: 60`, same as Workable and Recruitee.

## Acceptance criteria

- **AC1.** Given a board's RSS with N items, when the source runs, then it
  returns one `complete: true` feed for that board with N jobs, each with
  `externalId`, `title`, `company` (from `companies.ts`), `url` (the
  posting on `{token}.teamtailor.com`) and `postedAt` when the item has a
  date.
- **AC2.** Given an item with location and remote information in the
  feed, when it's mapped, then `locations` holds the location text and
  `workplace` is `remote` only when the feed says so (`null` otherwise,
  inferred later from text).
- **AC3.** Given a role that was stored and is missing from the next
  complete read of its board, when that run finishes, then the role is
  closed (existing pipeline rule, proved through a pipeline test with this
  source).
- **AC4.** Given a board that answers 404 or 410, when the source runs,
  then that feed is reported as `gone`, nothing is closed because of
  the failure, and the other boards are processed normally.
- **AC5.** Given a board that fails with a timeout or 5xx, when the source
  runs, then its stored roles stay open and the error is reported for that
  feed only.
- **AC6.** Given malformed XML or an item without a link or title, when
  it's parsed, then that item is skipped and the rest of the board is kept,
  with no exception escaping the adapter.
- **AC7.** Given a role on Teamtailor that also appears on a job board,
  when both are ingested, then the listing shows the Teamtailor copy and
  "Apply" goes to the employer's posting.
- **AC8.** After deploy, `/api/stats` lists the `teamtailor` source with a
  successful last run and at least one open role.
- **AC9.** The README sources table has a Teamtailor row (kind, scope,
  minimum interval), and "Adding a company" names the Teamtailor URL form.

## Constraints

- **Memory:** boards stream through `context.emit` like the other ATS
  sources; never hold every board at once. Parse items one by one; no XML
  library that builds a full DOM of every feed in memory.
- **Requests:** one request per board per run, at most
  `BOARD_CONCURRENCY` (4) at a time, through the shared helpers in
  `sources/http.ts` (timeout and User-Agent). `getText` exists but sends an
  HTML `Accept` and doesn't retry like `getJson`; the PR either extends it
  (an `accept` option, one retry on 5xx/429) or explains why not.
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
  close at the next cycle (documented behavior).

## Open questions

- [ ] **1. Is `jobs.rss` complete?** Compare the item count with the roles
      on the career page for 3 boards of different sizes, including one with
      more than 50 roles. If it's capped, find the paging parameter or stop:
      a partial feed can't be `complete: true`.
- [ ] **2. What does an item carry?** Full description or summary; location,
      remote/hybrid, department, employment type; a stable id. This decides
      AC2 and the mapping.
- [ ] **3. Seed list:** 5 to 10 tech employers whose own board is
      `{company}.teamtailor.com`, each checked by hand.
- [ ] **4. Rate limits or bot protection** on the feed at one request per
      board twice a day.

## Verification

Filled in by the implementing PR.

| AC | Proved by |
| --- | --- |
| AC1 | |
| AC2 | |
| AC3 | |
| AC4 | |
| AC5 | |
| AC6 | |
| AC7 | |
| AC8 | |
| AC9 | |
