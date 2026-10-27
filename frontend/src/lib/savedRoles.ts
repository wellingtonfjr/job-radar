/**
 * Saved roles and "applied" marks, kept in the browser (no accounts). Each
 * marked role keeps a small snapshot so the saved list can still show it
 * after the role closes. Storage can be unavailable (private mode, blocked
 * site data): marks then live in memory for this page load only.
 */
export interface MarkedRole {
  id: string;
  title: string;
  company: string;
  companyLogo: string | null;
  savedAt: string | null;
  appliedAt: string | null;
}

export type RoleMarks = Readonly<Record<string, MarkedRole>>;

/** What a toggle needs to store about the role. */
export type RoleSnapshot = Pick<MarkedRole, 'id' | 'title' | 'company' | 'companyLogo'>;

const STORAGE_KEY = 'job-radar:roleMarks';
const CHANGE_EVENT = 'job-radar:role-marks';

let marks: RoleMarks = {};
// Raw value `marks` was parsed from; re-parsed only when storage changes.
let parsedFrom: string | null | undefined;

function parse(raw: string | null): RoleMarks {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Record<string, MarkedRole> = {};
    for (const entry of Object.values(value as Record<string, Partial<MarkedRole>>)) {
      if (!entry || typeof entry.id !== 'string' || typeof entry.title !== 'string' || typeof entry.company !== 'string') continue;
      result[entry.id] = {
        id: entry.id,
        title: entry.title,
        company: entry.company,
        companyLogo: typeof entry.companyLogo === 'string' ? entry.companyLogo : null,
        savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : null,
        appliedAt: typeof entry.appliedAt === 'string' ? entry.appliedAt : null,
      };
    }
    return result;
  } catch {
    return {};
  }
}

/** Current marks; the same object until something changes (safe for `useSyncExternalStore`). */
export function getRoleMarks(): RoleMarks {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return marks;
  }
  if (raw !== parsedFrom) {
    parsedFrom = raw;
    marks = parse(raw);
  }
  return marks;
}

function write(next: RoleMarks): void {
  marks = next;
  try {
    const raw = JSON.stringify(next);
    window.localStorage.setItem(STORAGE_KEY, raw);
    parsedFrom = raw;
  } catch {
    // Keep the in-memory copy; it just won't survive a reload.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function toggle(role: RoleSnapshot, field: 'savedAt' | 'appliedAt'): void {
  const current = getRoleMarks();
  const existing = current[role.id];
  const entry: MarkedRole = {
    savedAt: existing?.savedAt ?? null,
    appliedAt: existing?.appliedAt ?? null,
    // Refresh the snapshot with what's on screen now.
    id: role.id,
    title: role.title,
    company: role.company,
    companyLogo: role.companyLogo,
    [field]: existing?.[field] ? null : new Date().toISOString(),
  };
  const next: Record<string, MarkedRole> = { ...current };
  if (entry.savedAt || entry.appliedAt) next[role.id] = entry;
  else delete next[role.id];
  write(next);
}

export function toggleSaved(role: RoleSnapshot): void {
  toggle(role, 'savedAt');
}

export function toggleApplied(role: RoleSnapshot): void {
  toggle(role, 'appliedAt');
}

/** Saved roles, most recently saved first. */
export function savedRoles(all: RoleMarks): MarkedRole[] {
  return Object.values(all)
    .filter((role) => role.savedAt)
    .sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
}

/** Notifies on changes from this tab and from other tabs (`storage` event). */
export function subscribeRoleMarks(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) callback();
  };
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
}
