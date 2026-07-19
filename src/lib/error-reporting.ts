// WrenchBid client-side error reporting.
//
// Production React does not rethrow boundary-caught errors to window.onerror,
// so they would otherwise vanish silently. This module gives every boundary a
// single reporting entry point; wire it to an external collector (Sentry,
// PostHog, ...) here when one is added.

type ErrorContext = Record<string, unknown>;

function describeError(error: unknown) {
  // Loaders and server fns commonly throw a raw Response; String(it) is the
  // opaque "[object Response]", so pull out the status and URL instead.
  if (error instanceof Response) {
    return `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function reportClientError(error: unknown, context: ErrorContext = {}) {
  if (typeof window === "undefined") return;
  console.error(
    `[wrenchbid] ${describeError(error)}`,
    { route: window.location.pathname, ...context },
    error,
  );
}
