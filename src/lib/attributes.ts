// Product attributes (#103), shared by the server and the browser: keys,
// value normalisation and the catalog's attribute filters. Definitions are
// managed in admin-attributes.ts; facets are computed in catalog-postgres.ts.

/** Attribute keys: lowercase Latin letters, digits and dashes. */
export const ATTRIBUTE_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_ATTRIBUTE_KEY = 40;
export const MAX_ATTRIBUTE_VALUE = 100;
/** Selected values in one catalog query. */
export const MAX_ATTRIBUTE_FILTERS = 20;
/** CSV columns holding attribute values: attr:<key>. */
export const ATTRIBUTE_COLUMN = "attr:";

/** Never a name every object already has ("constructor"): keys index objects. */
export const isAttributeKey = (key: string) =>
  key.length <= MAX_ATTRIBUTE_KEY &&
  ATTRIBUTE_KEY.test(key) &&
  !(key in Object.prototype);

/**
 * One facet value per meaning: letter case, spacing and the decimal sign do
 * not matter ("5W-30" = "5w-30", "1,5" = "1.5"). Signs do: "-20" is not "20".
 * Mirrors attribute_value_key() in migration 028.
 */
export const attributeValueKey = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([0-9]),([0-9])/g, "$1.$2")
    .toLowerCase();

/** Chosen value keys per attribute key; a product matches any per key. */
export type AttributeFilters = Record<string, string[]>;

export const attributeParam = (key: string, valueKey: string) =>
  `${key}:${valueKey}`;

/**
 * Filters from `key:value` strings (URL parameters): malformed ones are
 * dropped, duplicates merged, keys and values sorted, so equal filters always
 * look the same.
 */
export function parseAttributeFilters(
  values: readonly unknown[],
): AttributeFilters {
  const pairs = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const colon = value.indexOf(":");
    const key = value.slice(0, colon);
    const valueKey = attributeValueKey(value.slice(colon + 1));
    if (
      colon < 1 ||
      !isAttributeKey(key) ||
      !valueKey ||
      valueKey.length > MAX_ATTRIBUTE_VALUE ||
      /[\u0000-\u001f]/.test(valueKey)
    )
      continue;
    pairs.add(attributeParam(key, valueKey));
  }
  const filters: AttributeFilters = {};
  for (const pair of [...pairs].sort().slice(0, MAX_ATTRIBUTE_FILTERS)) {
    const colon = pair.indexOf(":");
    (filters[pair.slice(0, colon)] ??= []).push(pair.slice(colon + 1));
  }
  return filters;
}

/** The same filters as sorted `key:value` strings (for links). */
export const attributeParams = (filters: AttributeFilters): string[] =>
  Object.entries(filters)
    .flatMap(([key, values]) => values.map((v) => attributeParam(key, v)))
    .sort();

/** The filters with one value switched on or off. */
export function toggleAttribute(
  filters: AttributeFilters,
  key: string,
  valueKey: string,
  on: boolean,
): AttributeFilters {
  const param = attributeParam(key, valueKey);
  const others = attributeParams(filters).filter((p) => p !== param);
  return parseAttributeFilters(on ? [...others, param] : others);
}

/** "5W-30", "450 mm". */
export const attributeText = (value: string, unit: string) =>
  unit ? `${value} ${unit}` : value;
