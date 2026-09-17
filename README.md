# job-radar

Aggregates open job postings from public/free job-board APIs (Greenhouse, Lever,
RemoteOK, Remotive, Arbeitnow) into one filterable local dashboard, so you don't
depend on paid job-aggregator products.

## Structure

- `backend/` — Node.js + TypeScript + Express API, SQLite storage (`better-sqlite3`)
- `frontend/` — React + TypeScript (Vite) dashboard

## Shared contract

### `Job` type (`backend/src/types/job.ts`)

```ts
interface Job {
  id: string;            // internal id (source + externalId hash)
  source: string;        // e.g. "greenhouse", "lever", "remoteok"
  externalId: string;    // id as given by the source
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  allowedCountries: string[] | null; // ISO 3166-1 alpha-2 codes; null = no restriction detected
  url: string;           // link to the original posting
  description: string | null;
  tags: string[];
  postedAt: string | null;   // ISO date, if the source provides one
  firstSeenAt: string;       // ISO date, when job-radar first ingested it
}
```

### Adapter contract (`backend/src/adapters/types.ts`)

Every source adapter implements:

```ts
interface JobSourceAdapter {
  source: string;
  fetchJobs(): Promise<NewJob[]>; // NewJob = Job without id/firstSeenAt
}
```

Adapters live in `backend/src/adapters/<source>.ts`, one file per source, and only
fetch + normalize — they do not touch the database.

### API (`backend/src/api`)

`GET /api/jobs` — returns stored jobs, newest first.

Query params (all optional):
- `keyword` — matches title/company/description (case-insensitive substring)
- `location` — case-insensitive substring match
- `remoteOnly=true` — only remote jobs
- `source` — filter to one source
- `postedAfter` — ISO date, only jobs posted on/after this date
- `baseCountries` — comma-separated ISO 3166-1 alpha-2 codes (e.g. `PT,BR`). Forces
  `remote=1` and matches jobs whose `allowedCountries` is either `null` (no stated
  restriction) or overlaps any of the given codes. Union semantics across codes:
  a job restricted to `["PT"]` matches `baseCountries=PT,BR`.

Location-restriction parsing (`backend/src/lib/locationRestriction.ts`) is
best-effort free-text matching against a curated list of country/region names —
it will not catch every phrasing, and defaults to "unrestricted" when nothing
is recognized (a bias toward inclusion, not exclusion).

Response shape:
```json
{ "jobs": Job[], "total": number }
```

## Dev

```bash
cd backend && npm install && npm run dev   # http://localhost:3001
cd frontend && npm install && npm run dev  # http://localhost:5173
```
