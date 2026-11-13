// PostHog's error tracking extension, in its own lazily loaded chunk. The
// prebuilt bundle can't be tree-shaken (~59 KB gzip, every extension), which
// was accepted: it loads after the page, in production only. Importing just
// PostHogExceptions from posthog-js/lib was larger (its CommonJS deps).
export { ErrorTrackingExtensions } from 'posthog-js/dist/extension-bundles';
