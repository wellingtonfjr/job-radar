import type { RawJob } from "../src/domain/job.js";
import type { FetchOutcome, SourceAdapter, SourceKind } from "../src/sources/types.js";

export function rawJob(overrides: Partial<RawJob> & Pick<RawJob, "externalId">): RawJob {
  return {
    title: "Senior Software Engineer",
    company: "Acme",
    url: `https://example.com/jobs/${overrides.externalId}`,
    locations: ["Remote - Worldwide"],
    workplace: "remote",
    postedAt: "2026-10-10T00:00:00Z",
    ...overrides,
  };
}

/** A source whose next fetch result can be swapped between runs. */
export function fakeSource(id: string, kind: SourceKind = "ats") {
  let next: FetchOutcome = { results: [], errors: [] };
  const source: SourceAdapter & { respond(outcome: FetchOutcome): void } = {
    id,
    name: id,
    kind,
    homepage: `https://${id}.example`,
    minIntervalMinutes: 60,
    fetchJobs: async () => next,
    respond(outcome) {
      next = outcome;
    },
  };
  return source;
}
