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
              group: ["**/catalog-demo-data"],
              message:
                "Read products through catalog() from catalog-server or useCatalog().",
            },
          ],
        },
      ],
    },
  },
  {
    // Legacy client components that set state synchronously in effects or
    // write refs during render. They power cart, checkout and account flows,
    // so they are refactored only once Playwright covers those journeys
    // (#23); the refactor is tracked in #59.
    // The rules stay errors for every other file, including new code.
    name: "legacy-react-compiler-findings",
    files: [
      "src/components/admin-orders.tsx",
      "src/components/cart-provider.tsx",
      "src/components/checkout.tsx",
      "src/components/customer-provider.tsx",
      "src/components/my-orders.tsx",
      "src/components/product-media-admin.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
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
