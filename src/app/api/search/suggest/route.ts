// Search suggestions for the header autocomplete (#37): a few products and
// categories for a partial query, from searchProvider() (ADR 0003).
// Public and rate limited per client; prices are live, so not cached.
import { NextResponse } from "next/server";
import { MAX_BROWSE_TEXT } from "../../../../lib/catalog";
import { searchProvider } from "../../../../lib/catalog-server";
import { localeFromCookie, parseLocale } from "../../../../lib/i18n/locale";
import { clientKey, createRateLimiter } from "../../../../lib/rate-limit";
import {
  MIN_SUGGEST_CHARS,
  type SuggestResponse,
} from "../../../../lib/search";
import { logError } from "../../../../lib/log";

// Generous for typing (one request per pause), tight for scripts.
const limiter = createRateLimiter(30, 10_000);

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const limit = limiter.take(clientKey(request));
  if (!limit.allowed)
    return NextResponse.json(
      { error: "Твърде много заявки. Опитай отново след малко." },
      {
        status: 429,
        headers: { ...headers, "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, MAX_BROWSE_TEXT);
  const locale = params.has("locale")
    ? parseLocale(params.get("locale"))
    : localeFromCookie(request.headers.get("cookie") ?? "");
  const empty: SuggestResponse = { products: [], categories: [] };
  if (q.length < MIN_SUGGEST_CHARS)
    return NextResponse.json(empty, { headers });
  try {
    const found = await searchProvider(locale).suggest(q, 6);
    const body: SuggestResponse = {
      products: found.products.map((p) => ({
        sku: p.sku,
        name: p.name,
        category: (p.subcategory ?? p.category).name,
        image: p.image,
        priceCents: p.priceCents,
        ...(p.salePriceCents !== undefined && {
          salePriceCents: p.salePriceCents,
        }),
        href: `/catalog/${encodeURIComponent(p.sku)}`,
      })),
      categories: found.categories.map((c) => {
        const query = new URLSearchParams({ category: c.category });
        if (c.subcategory) query.set("subcategory", c.subcategory);
        return {
          name: c.name,
          ...(c.parent && { parent: c.parent }),
          href: `/catalog?${query}`,
        };
      }),
    };
    return NextResponse.json(body, { headers });
  } catch (error) {
    void logError("Search suggestions failed", error);
    return NextResponse.json(
      { error: "Търсенето временно не е достъпно." },
      { status: 503, headers },
    );
  }
}
