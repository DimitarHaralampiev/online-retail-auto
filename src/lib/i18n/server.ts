import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale } from "./locale";
export async function requestLocale() {
  return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}
