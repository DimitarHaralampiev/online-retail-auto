// Language from the URL (#40): ?lang=en (or bg) shows that language for the
// request and remembers it in the locale cookie. Each language therefore has
// its own URL for search engines (hreflang), while visitors keep the cookie.
// Runs only for page requests that carry ?lang=.
import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, parseLocale } from "./lib/i18n/locale";
import { LOCALE_HEADER } from "./lib/i18n/url-locale";

export function proxy(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("lang");
  if (value !== "bg" && value !== "en") return NextResponse.next();
  const locale = parseLocale(value);
  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, locale);
  const response = NextResponse.next({ request: { headers } });
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
      source: "/((?!api|_next/static|_next/image|images|favicon.ico).*)",
      has: [{ type: "query", key: "lang" }],
    },
  ],
};
