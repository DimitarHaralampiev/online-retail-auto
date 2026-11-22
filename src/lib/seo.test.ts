import assert from "node:assert/strict";
import { test } from "node:test";
import { localizedPath, pageMetadata, siteUrl } from "./seo";

const withEnv = (env: Record<string, string | undefined>, run: () => void) => {
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  for (const [key, value] of Object.entries(env))
    if (value === undefined) delete process.env[key];
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
};

test("English URLs carry ?lang=en; Bulgarian is the plain URL", () => {
  assert.equal(
    localizedPath("/catalog?category=car-care", "en"),
    "/catalog?category=car-care&lang=en",
  );
  assert.equal(
    localizedPath("/catalog?lang=en&category=car-care", "bg"),
    "/catalog?category=car-care",
  );
  assert.equal(localizedPath("/", "en"), "/?lang=en");
});

test("metadata has canonical, hreflang and Open Graph per language", () => {
  withEnv({ SITE_INDEXABLE: "1" }, () => {
    const meta = pageMetadata({
      locale: "en",
      path: "/catalog/DEMO-003",
      title: "Air filter",
      description: "  Demo   product.\nText ",
      image: "/images/air-filter.png",
    });
    assert.equal(meta.title, "Air filter — AUTO/SHOP");
    assert.equal(meta.description, "Demo product. Text");
    assert.deepEqual(meta.alternates, {
      canonical: "/catalog/DEMO-003?lang=en",
      languages: {
        bg: "/catalog/DEMO-003",
        en: "/catalog/DEMO-003?lang=en",
        "x-default": "/catalog/DEMO-003",
      },
    });
    assert.equal((meta.openGraph as { locale: string }).locale, "en_GB");
    assert.deepEqual(meta.robots, { index: true, follow: true });
    // Search results and private pages stay out of the index.
    assert.deepEqual(
      pageMetadata({
        locale: "bg",
        path: "/catalog",
        title: "t",
        description: "d",
        index: false,
      }).robots,
      { index: false, follow: true },
    );
  });
});

test("nothing is indexable until SITE_INDEXABLE=1", () => {
  withEnv({ SITE_INDEXABLE: undefined }, () => {
    assert.deepEqual(
      pageMetadata({ locale: "bg", path: "/", title: "t", description: "d" })
        .robots,
      { index: false, follow: false },
    );
  });
});

test("long texts are clipped for search snippets", () => {
  const meta = pageMetadata({
    locale: "bg",
    path: "/",
    title: "Т".repeat(100),
    description: "О".repeat(400),
  });
  assert.ok(String(meta.title).length <= 70);
  assert.ok(String(meta.description).length <= 160);
  assert.ok(String(meta.description).endsWith("…"));
});

test("the site URL comes from APP_URL with a safe fallback", () => {
  withEnv({ APP_URL: "https://shop.example" }, () =>
    assert.equal(siteUrl().origin, "https://shop.example"),
  );
  withEnv({ APP_URL: "not a url" }, () =>
    assert.equal(siteUrl().origin, "http://localhost:3000"),
  );
});
