import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, parseLocale } from "./locale";
import { LOCALE_HEADER } from "./url-locale";

/** The page language: ?lang= in the URL (via the proxy), else the cookie. */
export async function requestLocale() {
  const fromUrl = (await headers()).get(LOCALE_HEADER);
  if (fromUrl) return parseLocale(fromUrl);
  return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}
