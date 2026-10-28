import { arbeitnowSource } from "./arbeitnow.js";
import { ashbySource } from "./ashby.js";
import { getOnBrdSource } from "./getonbrd.js";
import { greenhouseSource } from "./greenhouse.js";
import { himalayasSource } from "./himalayas.js";
import { inhireSource } from "./inhire.js";
import { jobicySource } from "./jobicy.js";
import { leverSource } from "./lever.js";
import type { SourceAdapter } from "./types.js";

/** Every source, ATS first (their postings win de-duplication). */
export const SOURCES: SourceAdapter[] = [
  greenhouseSource,
  leverSource,
  ashbySource,
  inhireSource,
  himalayasSource,
  jobicySource,
  arbeitnowSource,
  getOnBrdSource,
];

export function findSource(id: string): SourceAdapter | undefined {
  return SOURCES.find((s) => s.id === id);
}
