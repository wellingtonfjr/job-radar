import type { NewJob } from "../types/job.js";

export interface JobSourceAdapter {
  source: string;
  fetchJobs(): Promise<NewJob[]>;
}
