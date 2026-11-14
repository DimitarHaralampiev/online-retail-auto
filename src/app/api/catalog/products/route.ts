import { NextResponse } from "next/server";
import { catalog } from "../../../../lib/catalog-server";
import { parseLookupSkus } from "../../../../lib/catalog-lookup";
import { localeFromCookie, parseLocale } from "../../../../lib/i18n/locale";

// Public storefront data (published products only); prices and stock are
// live, so responses are not cached.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = parseLookupSkus(params);
  // Names follow ?locale= (the client cache asks explicitly), else the cookie.
  const locale = params.has("locale")
    ? parseLocale(params.get("locale"))
    : localeFromCookie(request.headers.get("cookie") ?? "");
  const headers = { "Cache-Control": "no-store" };
  if ("error" in parsed)
    return NextResponse.json({ error: parsed.error }, { status: 400, headers });
  try {
    const products = await catalog(locale).getProducts(parsed.skus);
    return NextResponse.json({ products }, { headers });
  } catch (error) {
    console.error("Catalog product lookup failed", error);
    return NextResponse.json(
      { error: "Каталогът временно не е достъпен." },
      { status: 503, headers },
    );
  }
}
