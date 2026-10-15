/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin for production builds; empty = same origin. */
  readonly VITE_API_URL?: string;
}
