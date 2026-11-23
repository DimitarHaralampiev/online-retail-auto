// Security headers (#51). The Content-Security-Policy is built per request
// with a fresh nonce (src/proxy.ts): only scripts carrying it run, and
// 'strict-dynamic' lets them load the app's own chunks. Styles allow inline
// attributes (React and next/image set style attributes, which nonces cannot
// cover). Fixed headers for every response live in next.config.ts.

export function contentSecurityPolicy(
  nonce: string,
  { dev = false, https = false }: { dev?: boolean; https?: boolean } = {},
): string {
  const directives = [
    "default-src 'self'",
    // React needs eval only in development (error stacks); never in production.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    // Development needs the hot-reload websocket.
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Card payments redirect to Stripe Checkout (a navigation, not a form post).
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

/** Headers for every response (pages, API routes, assets). */
export function staticSecurityHeaders(production: boolean) {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    // Two years; only over HTTPS in production (never pin localhost).
    ...(production
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ]
      : []),
  ];
}
