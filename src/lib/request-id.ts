// Request ids (#52): set by src/proxy.ts on every page and API request and
// returned in the response, so a visitor's report, the log lines and the
// error report of one request can be matched. Kept free of dependencies
// because the proxy imports it.

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * The id a load balancer or proxy in front of the app already assigned, if
 * it looks like one; otherwise a new random id.
 */
export function requestIdFrom(value: string | null | undefined): string {
  return value && /^[A-Za-z0-9._:-]{8,100}$/.test(value)
    ? value
    : crypto.randomUUID();
}
