# job-radar

Open roles, verified daily: job-radar scans employers' career pages and public
job boards, normalizes every posting (category, level, work mode, salary,
where you can work from, stack) and drops roles as soon as they're taken
down. Every role links to the original posting.

The UI is a search-first workspace: filters in a sidebar (a full-screen sheet
on phones), removable filter tokens, and on wide screens a list + preview
split view whose selection is part of the URL (`?job=…`).

## Why the jobs are "real and updated"

| Problem with typical boards | What job-radar does |
| --- | --- |
| Stale listings that stay up for months | Each company's job board is read **in full**. A job that disappears from it is closed at the next run. Jobs from partially-read feeds are closed after `STALE_AFTER_DAYS` (default 30) without being seen, or at the source's expiry date. |
| Reposts of reposts | Postings come from the employer's own ATS (Greenhouse, Lever, Ashby) first. When the same opening also appears on an aggregator, only the ATS copy is shown (see `recomputeCanonical`). |
| "Remote" that isn't open to you | Locations are parsed into ISO country lists (regions like *EMEA* and *LATAM* are expanded). The **Your location** filter shows remote jobs open to that country, plus hybrid and on-site jobs located there. |
| No salary info | Salaries come from structured fields (Ashby, Lever, Himalayas, Jobicy) or from pay-transparency text in descriptions ("base salary range is $150,000 – $190,000"). They're annualized to approximate USD for the min-salary filter. |
| Can't tell good payers apart | **Pay band** (Top ≥ $120k, High ≥ $90k, Fair ≥ $50k) is the median of the salaries each company *publishes*, never a guess. Companies with fewer than 2 salaries get no band. (API field: `companyTier` = `S`/`A`/`B`.) |

## Sources

| Source | Kind | Scope | Cadence |
| --- | --- | --- | --- |
| Greenhouse, Lever, Ashby | Employer ATS | Full board for each company in `backend/src/sources/companies.ts` | hourly |
| Himalayas | Aggregator | Newest 500 remote jobs per run (the feed has 100k+) | hourly |
| Jobicy | Aggregator | Up to 500 remote jobs | every 2h |
| Arbeitnow | Aggregator | Full feed (Europe-heavy) | hourly |
| Remotive | Aggregator | Public sample feed only (~15 jobs, delayed 24h) | every 6h, per its terms |

Aggregator jobs link back to the aggregator's posting, as their API terms
require. Remotive's free API is deliberately small; most volume comes from the
ATS boards.

**Adding a company:** find its careers URL (`boards.greenhouse.io/{token}`,
`jobs.lever.co/{token}` or `jobs.ashbyhq.com/{token}`) and add
`{ token, name }` to the matching list in `companies.ts`.

## Structure

```
backend/   Node 20+ · TypeScript · Express · SQLite (better-sqlite3)
  src/sources/     one adapter per source (fetch + map only)
  src/normalize/   category, seniority, employment type, salary, location, skills, dedup keys
  src/ingestion/   pipeline (upsert/close/retire/dedup/tiers), scheduler, CLI
  src/api/         GET /api/jobs, /api/jobs/:id, /api/stats
frontend/  React 19 · TypeScript · Vite (no router/UI libraries)
```

## Running it

```bash
cd backend && npm install && npm run ingest -- --force   # first fill (~30s)
npm run dev                                              # API on :3001, scheduler on
```

```bash
cd frontend && npm install && npm run dev                # UI on :5173, proxies /api
```

The API refreshes due sources on startup and every `SCHEDULER_TICK_MINUTES`
(default 15), respecting each source's minimum interval. Other settings:
`PORT`, `DB_PATH`, `STALE_AFTER_DAYS`, `SCHEDULER=off`, `CORS_ORIGIN`. For a
production frontend build, set `VITE_API_URL` if the API isn't same-origin.

`npm run ingest` runs only the sources that are due. Pass `--force` to ignore
intervals, and source ids to limit the run (`npm run ingest -- --force lever`).

## API

`GET /api/jobs` returns one deduplicated copy per opening, newest first. All parameters are optional:

| Param | Example | Notes |
| --- | --- | --- |
| `q` | `react senior` | every word must match title/company/skills/tags, spelling-insensitive (`frontend` = `Front-End`) |
| `category` | `software-development,design` | ids from `/api/stats` |
| `country` | `BR` | eligible to work from (see above) |
| `workplace` | `remote,hybrid` | `remote` · `hybrid` · `onsite` |
| `seniority` | `senior,lead` | `intern` · `junior` · `mid` · `senior` · `lead` · `executive` |
| `type` | `full_time,contract` | employment type |
| `skills` | `TypeScript,Go` | any of |
| `tier` | `S,A` | company pay band (`S` top, `A` high, `B` fair) |
| `minSalary` | `100000` | ≈ USD/year; jobs without a salary are excluded |
| `postedWithin` | `7` | days |
| `source`, `company` | `ashby`, `openai` | `source` shows that source's own copies (no dedup) |
| `page`, `pageSize` | `2`, `20` | `pageSize` ≤ 50 |

`GET /api/jobs/:id` returns the full job (plain-text description), plus
`closedAt` and `alsoOn` (other sources listing the same opening).
`GET /api/stats` returns totals, facet counts, the countries present, and each
source's last run.

## Checks

```bash
cd backend && npm run typecheck && npm test
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
```

## Known limitations

- Classification (category, seniority, stack) is rule-based and English-first.
  It's right for the large majority of postings, but not all. Seniority is left
  empty rather than guessed.
- Country detection knows the countries, regions and major cities listed in
  `normalize/location.ts`. An unknown city on an on-site job means it won't
  match a country filter.
- Salary conversion uses static, approximate exchange rates and is only used
  for filtering. Salaries are always displayed in the original currency.
- Himalayas posts jobs faster than an hourly 500-job window can cover, so its
  jobs are a sample, not the full feed.
