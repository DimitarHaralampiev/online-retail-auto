// The catalog page's URL is its state: /catalog?category=…&subcategory=…&q=…
// &min=…&max=…&available=1&promotions=1&car=1&sort=…&page=…
// Everything a visitor can type into the URL is parsed here with Zod into a
// safe BrowseQuery; links are built here too, so the format lives in one place.
import { z } from "zod";
import {
  MAX_BROWSE_TEXT,
  MAX_PAGE,
  type BrowseQuery,
  type BrowseSort,
} from "./catalog";
import { priceFilterCents } from "./catalog-browse";

/** Filter state as it appears in the URL (strings, as typed by visitors). */
export type CatalogUrlState = {
  category: string;
  subcategory: string;
  q: string;
  min: string;
  max: string;
  available: boolean;
  promotions: boolean;
  car: boolean;
  sort: BrowseSort;
  page: number;
};

export const EMPTY_CATALOG_STATE: CatalogUrlState = {
  category: "",
  subcategory: "",
  q: "",
  min: "",
  max: "",
  available: false,
  promotions: false,
  car: false,
  sort: "featured",
  page: 1,
};

// Repeated parameters (?q=a&q=b) use the first value; anything malformed
// falls back to "not set" instead of failing the page.
const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);
const text = (max: number) =>
  z.preprocess(
    first,
    z
      .string()
      .catch("")
      .transform((value) => value.trim().slice(0, max)),
  );
const flag = z
  .preprocess(first, z.string().catch(""))
  .transform((v) => v === "1");

const schema = z.object({
  category: text(120),
  subcategory: text(80),
  q: text(MAX_BROWSE_TEXT),
  min: text(12),
  max: text(12),
  available: flag,
  promotions: flag,
  car: flag,
  sort: z.preprocess(
    first,
    z.enum(["featured", "price-asc", "price-desc", "name"]).catch("featured"),
  ),
  page: z.preprocess(
    first,
    z.coerce.number().int().min(1).max(MAX_PAGE).catch(1),
  ),
});

export function parseCatalogUrl(
  params: Record<string, string | string[] | undefined>,
): CatalogUrlState {
  return schema.parse(params);
}

/** Price bounds in cents, or invalid when malformed or reversed. */
export function priceRange(
  state: Pick<CatalogUrlState, "min" | "max">,
):
  | { valid: true; minPriceCents?: number; maxPriceCents?: number }
  | { valid: false } {
  const min = priceFilterCents(state.min);
  const max = priceFilterCents(state.max);
  if (
    min === undefined ||
    max === undefined ||
    (min !== null && max !== null && min > max)
  )
    return { valid: false };
  return {
    valid: true,
    minPriceCents: min ?? undefined,
    maxPriceCents: max ?? undefined,
  };
}

/** BrowseQuery for the URL state; vehicle fitment is added by the server. */
export function browseQueryFor(
  state: CatalogUrlState,
  locale: "bg" | "en",
  pageSize?: number,
): BrowseQuery | null {
  const prices = priceRange(state);
  if (!prices.valid) return null;
  return {
    category: state.category || undefined,
    subcategory: state.subcategory || undefined,
    text: state.q || undefined,
    minPriceCents: prices.minPriceCents,
    maxPriceCents: prices.maxPriceCents,
    available: state.available,
    promotions: state.promotions,
    sort: state.sort,
    locale,
    page: state.page,
    pageSize,
  };
}

/**
 * Link to the catalog with `changes` applied. Any filter change returns to the
 * first page; default values are left out so URLs stay short and canonical.
 */
export function catalogHref(
  state: CatalogUrlState,
  changes: Partial<CatalogUrlState> = {},
): string {
  const next = { ...state, ...changes };
  if (!("page" in changes)) next.page = 1;
  const params = new URLSearchParams();
  if (next.category) params.set("category", next.category);
  if (next.subcategory) params.set("subcategory", next.subcategory);
  if (next.q) params.set("q", next.q);
  if (next.min) params.set("min", next.min);
  if (next.max) params.set("max", next.max);
  if (next.available) params.set("available", "1");
  if (next.promotions) params.set("promotions", "1");
  if (next.car) params.set("car", "1");
  if (next.sort !== "featured") params.set("sort", next.sort);
  if (next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return query ? `/catalog?${query}` : "/catalog";
}
