import { NextResponse } from "next/server";
import { catalog } from "../../../../lib/catalog-server";
import { parseLookupSkus } from "../../../../lib/catalog-lookup";

// Public storefront data (published products only); prices and stock are
// live, so responses are not cached.
export async function GET(request: Request) {
  const parsed = parseLookupSkus(new URL(request.url).searchParams);
  const headers = { "Cache-Control": "no-store" };
  if ("error" in parsed)
    return NextResponse.json({ error: parsed.error }, { status: 400, headers });
  try {
    const products = await catalog().getProducts(parsed.skus);
    return NextResponse.json({ products }, { headers });
  } catch {
    return NextResponse.json(
      { error: "Каталогът временно не е достъпен." },
      { status: 503, headers },
    );
  }
}
