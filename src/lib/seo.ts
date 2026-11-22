// Page metadata (#40): canonical URL, hreflang alternates, Open Graph and
// robots. Bulgarian, the store's language, lives at the plain URL and is the
// x-default; English at the same URL with ?lang=en (see src/proxy.ts).
//
// Indexing is opt-in: until the shop goes live (#56) every page is noindex
// unless SITE_INDEXABLE=1, so demo data never reaches search engines.
import type { Metadata } from "next";
import type { Locale } from "./i18n/locale";

export const SITE_NAME = "AUTO/SHOP";

/** Absolute site origin from APP_URL (also used for links in emails). */
export function siteUrl(): URL {
  try {
    return new URL(process.env.APP_URL || "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}

export const indexable = () => process.env.SITE_INDEXABLE === "1";

/** `path` (with its own query, if any) in a language: ?lang=en for English. */
export function localizedPath(path: string, locale: Locale): string {
  const url = new URL(path, "http://x");
  url.searchParams.delete("lang");
  if (locale === "en") url.searchParams.set("lang", "en");
  return url.pathname + url.search;
}

export type PageMetadataInput = {
  locale: Locale;
  /** Canonical path of the page, without ?lang. */
  path: string;
  title: string;
  description: string;
  /** Absolute or site-relative image for social previews. */
  image?: string;
  /** False for pages that must never be indexed (search results, carts). */
  index?: boolean;
};

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

export function pageMetadata(input: PageMetadataInput): Metadata {
  const { locale, path } = input;
  const title = clip(`${input.title} — ${SITE_NAME}`, 70);
  const description = clip(input.description.replace(/\s+/g, " ").trim(), 160);
  const url = localizedPath(path, locale);
  const index = indexable() && input.index !== false;
  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        bg: localizedPath(path, "bg"),
        en: localizedPath(path, "en"),
        "x-default": localizedPath(path, "bg"),
      },
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description,
      url,
      locale: locale === "en" ? "en_GB" : "bg_BG",
      alternateLocale: locale === "en" ? ["bg_BG"] : ["en_GB"],
      ...(input.image && { images: [{ url: input.image }] }),
    },
    twitter: {
      card: input.image ? "summary_large_image" : "summary",
      title,
      description,
    },
    robots: index
      ? { index: true, follow: true }
      : { index: false, follow: indexable() },
  };
}
