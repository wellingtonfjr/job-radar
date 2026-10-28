/**
 * The UI language: the visitor's choice (kept in localStorage), else guessed
 * from the browser. A tiny external store, like savedRoles, so components can
 * read it with `useSyncExternalStore` and need no provider.
 */
export type Locale = 'en' | 'pt-BR';

export const LOCALES: readonly { id: Locale; short: string; name: string }[] = [
  { id: 'en', short: 'EN', name: 'English' },
  { id: 'pt-BR', short: 'PT', name: 'Português' },
];

const STORAGE_KEY = 'job-radar:locale';
const CHANGE_EVENT = 'job-radar:locale';

let current: Locale | null = null;

function isLocale(value: unknown): value is Locale {
  return LOCALES.some((l) => l.id === value);
}

/** Any Portuguese in the browser's languages means pt-BR; otherwise English. */
export function detectLocale(languages: readonly string[]): Locale {
  return languages.some((l) => l.toLowerCase().startsWith('pt')) ? 'pt-BR' : 'en';
}

function storedLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function getLocale(): Locale {
  current ??= storedLocale() ?? detectLocale(navigator.languages?.length ? navigator.languages : [navigator.language ?? 'en']);
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage unavailable: the choice lasts for this page load only.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Notifies on changes from this tab and from other tabs (`storage` event). */
export function subscribeLocale(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    current = null;
    callback();
  };
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
}
