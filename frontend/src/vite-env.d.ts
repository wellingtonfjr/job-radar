/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin for production builds; empty = same origin. */
  readonly VITE_API_URL?: string;
  /** PostHog project key (public by design). Unset = no analytics. */
  readonly VITE_POSTHOG_KEY?: string;
  /** PostHog ingestion host; defaults to the US cloud. */
  readonly VITE_POSTHOG_HOST?: string;
}
