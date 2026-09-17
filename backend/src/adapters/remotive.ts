import type { JobSourceAdapter } from "./types.js";
import type { NewJob } from "../types/job.js";
import { stripHtml } from "./html.js";

/** https://remotive.com/api/remote-jobs — public, no API key. */
interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category?: string;
  tags?: string[];
  publication_date?: string;
  candidate_required_location?: string;
  description?: string;
}

interface RemotiveResponse {
  jobs: RemotiveJob[];
}

export const remotiveAdapter: JobSourceAdapter = {
  source: "remotive",
  async fetchJobs(): Promise<NewJob[]> {
    try {
      const res = await fetch("https://remotive.com/api/remote-jobs");
      if (!res.ok) {
        throw new Error(`Remotive responded ${res.status}`);
      }
      const data = (await res.json()) as RemotiveResponse;
      return data.jobs.map((j): NewJob => {
        const tags = [...(j.tags ?? [])];
        if (j.category) tags.push(j.category);
        return {
          source: "remotive",
          externalId: String(j.id),
          title: j.title,
          company: j.company_name,
          location: j.candidate_required_location ?? null,
          remote: true, // Remotive exclusively lists remote jobs
          url: j.url,
          description: stripHtml(j.description),
          tags,
          postedAt: j.publication_date ?? null,
        };
      });
    } catch (err) {
      console.error("[remotive] failed to fetch jobs:", err);
      return [];
    }
  },
};
