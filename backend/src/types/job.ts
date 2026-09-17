export interface Job {
  id: string;
  source: string;
  externalId: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  url: string;
  description: string | null;
  tags: string[];
  postedAt: string | null;
  firstSeenAt: string;
}

export type NewJob = Omit<Job, "id" | "firstSeenAt">;

export interface JobFilters {
  keyword?: string;
  location?: string;
  remoteOnly?: boolean;
  source?: string;
  postedAfter?: string;
}
