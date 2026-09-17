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

Response shape:
```json
{ "jobs": Job[], "total": number }
```

## Dev

```bash
cd backend && npm install && npm run dev   # http://localhost:3001
cd frontend && npm install && npm run dev  # http://localhost:5173
```
