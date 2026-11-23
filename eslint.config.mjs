import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `const { secret, ...rest } = value` intentionally drops a field.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Catalog data is read through the CatalogRepository (catalog-server.ts)
    // on the server and the CatalogProvider on the client. Only the static
    // adapter wiring and tests may import the demo data directly.
    ignores: [
      "src/lib/catalog-server.ts",
      "src/lib/catalog-seed.ts",
      "src/lib/**/*.test.ts",
      "tests/**",
      "scripts/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/catalog-demo-data", "**/catalog-demo-data.*"],
              message:
                "Read products through catalog() from catalog-server or useCatalog().",
            },
          ],
        },
      ],
    },
  },
  {
    // Components may run in the browser: server data access (and anything
    // that imports it) must stay out of client bundles.
    files: ["src/components/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/catalog-demo-data",
                "**/catalog-demo-data.*",
                "**/catalog-server",
                "**/catalog-server.*",
              ],
              message:
                "Components read catalog data with useCatalog(); load it on the server in a page or layout.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "coverage/**",
    "next-env.d.ts",
    ".agents/**",
    ".aws/**",
    ".codex/**",
  ]),
]);
