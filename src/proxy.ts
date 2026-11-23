// Runs before every page and API request:
// - A request id (#52), taken from a trusted upstream header when present,
//   passed to the app (logs, error reports) and returned to the client.
// - Content-Security-Policy (pages only) with a fresh nonce (#51); Next.js applies the
//   nonce to its own scripts by reading the request's CSP header.
// - Language from the URL (#40): ?lang=en (or bg) shows that language for
//   the request and remembers it in the locale cookie, so each language has
//   its own URL for search engines (hreflang).
import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, parseLocale } from "./lib/i18n/locale";
import { LOCALE_HEADER } from "./lib/i18n/url-locale";
import { REQUEST_ID_HEADER, requestIdFrom } from "./lib/request-id";
import { contentSecurityPolicy } from "./lib/security-headers";

export function proxy(request: NextRequest) {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    const response = NextResponse.next({ request: { headers } });
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, {
    dev: process.env.NODE_ENV === "development",
    https: request.nextUrl.protocol === "https:",
  });
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const value = request.nextUrl.searchParams.get("lang");
  const locale = value === "bg" || value === "en" ? parseLocale(value) : null;
  if (locale) headers.set(LOCALE_HEADER, locale);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  if (locale)
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: 31_536_000,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes, static files, images and media are excluded,
      // and so are next/link prefetches.
      source:
        "/((?!api|_next/static|_next/image|images|media|sitemaps|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    // API routes: request ids only.
    "/api/:path*",
  ],
};
