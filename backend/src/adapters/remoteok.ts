import type { JobSourceAdapter } from "./types.js";
import type { NewJob } from "../types/job.js";

/**
 * https://remoteok.com/api — public, no API key.
 * The response is a plain JSON array; the FIRST element is always a legal
 * notice object (`{ "legal": "..." }`, no job fields), not a job, so we
 * skip it.
 */
interface RemoteOkJob {
  id?: string;
  slug?: string;
  position?: string;
  company?: string;
  location?: string;
  tags?: string[];
  description?: string;
  url?: string;
  apply_url?: string;
  date?: string;
  epoch?: number;
}

export const remoteOkAdapter: JobSourceAdapter = {
  source: "remoteok",
  async fetchJobs(): Promise<NewJob[]> {
    try {
      const res = await fetch("https://remoteok.com/api", {
        headers: {
          // RemoteOK blocks requests without a descriptive User-Agent.
          "User-Agent": "job-radar (personal project; https://github.com/)",
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        throw new Error(`RemoteOK responded ${res.status}`);
      }
      const data = (await res.json()) as unknown[];
      const jobs = data.slice(1) as RemoteOkJob[];
      return jobs
        .filter((j) => j.id && j.position)
        .map(
          (j): NewJob => ({
            source: "remoteok",
            externalId: String(j.id),
            title: j.position ?? "Untitled",
            company: j.company ?? "Unknown",
            location: j.location && j.location.trim() !== "" ? j.location : null,
            remote: true, // RemoteOK exclusively lists remote jobs
            url: j.url ?? j.apply_url ?? `https://remoteok.com/remote-jobs/${j.slug ?? j.id}`,
            description: j.description ?? null,
            tags: j.tags ?? [],
            postedAt: j.date ?? (j.epoch ? new Date(j.epoch * 1000).toISOString() : null),
          })
        );
    } catch (err) {
      console.error("[remoteok] failed to fetch jobs:", err);
      return [];
    }
  },
};
