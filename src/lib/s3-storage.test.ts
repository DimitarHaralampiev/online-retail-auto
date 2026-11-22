import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaDriver, mediaKey } from "./media-storage";
import { createS3Storage, s3ConfigFromEnv } from "./s3-storage";

const config = {
  endpoint: "https://account.r2.cloudflarestorage.com",
  bucket: "shop-media",
  region: "auto",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret-example",
};

function fakeFetch(responses: Record<string, number>) {
  const calls: Request[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push(request);
    const status = responses[request.method] ?? 200;
    return new Response(
      status === 200 && request.method === "GET" ? "img" : null,
      {
        status,
      },
    );
  }) as typeof fetch;
  return { fetcher, calls };
}

test("requests are SigV4-signed, path-style and encoded", async () => {
  const { fetcher, calls } = fakeFetch({});
  const storage = createS3Storage(config, fetcher);
  await storage.put(
    "products/BRK-1/abc.v2",
    new Uint8Array([1, 2, 3]),
    "image/png",
  );
  const request = calls[0];
  assert.equal(request.method, "PUT");
  assert.equal(
    request.url,
    "https://account.r2.cloudflarestorage.com/shop-media/products/BRK-1/abc.v2",
  );
  assert.match(
    request.headers.get("authorization")!,
    /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/,
  );
  assert.ok(request.headers.get("x-amz-date"));
  assert.ok(request.headers.get("x-amz-content-sha256"));
  assert.equal(request.headers.get("content-type"), "image/png");
});

test("reads, missing objects and failures", async () => {
  const ok = createS3Storage(config, fakeFetch({}).fetcher);
  assert.deepEqual(
    [...(await ok.get("k"))!],
    [...new TextEncoder().encode("img")],
  );
  const missing = createS3Storage(
    config,
    fakeFetch({ GET: 404, DELETE: 404 }).fetcher,
  );
  assert.equal(await missing.get("k"), null);
  await missing.delete("k"); // already gone: fine
  const broken = createS3Storage(
    config,
    fakeFetch({ PUT: 403, GET: 500, DELETE: 500 }).fetcher,
  );
  await assert.rejects(
    broken.put("k", new Uint8Array([1]), "image/png"),
    /refused the upload \(403\)/,
  );
  await assert.rejects(broken.get("k"), /read failed \(500\)/);
  await assert.rejects(broken.delete("k"), /delete failed \(500\)/);
});

test("storage keys cannot escape the bucket", async () => {
  const storage = createS3Storage(config, fakeFetch({}).fetcher);
  for (const key of ["../x", "a/../b", "/abs", "", "a\nb"])
    await assert.rejects(storage.get(key), /Invalid storage key/, key);
  assert.equal(mediaKey("BRK/../1", "id-1"), "products/BRK_.._1/id-1");
  await assert.rejects(
    storage.get(mediaKey("BRK/../1", "id-1")),
    /Invalid storage key/,
  );
  assert.equal(mediaKey("BRK-1", "id-1"), "products/BRK-1/id-1");
});

test("configuration comes from the environment", () => {
  assert.equal(mediaDriver(undefined), "database");
  assert.equal(mediaDriver("s3"), "s3");
  assert.throws(() => mediaDriver("ftp"), /must be "database" or "s3"/);
  assert.throws(
    () => s3ConfigFromEnv({ S3_ENDPOINT: "https://x" }),
    /requires S3_BUCKET/,
  );
  assert.deepEqual(
    s3ConfigFromEnv({
      S3_ENDPOINT: "https://x/",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "id",
      S3_SECRET_ACCESS_KEY: "secret",
    }),
    {
      endpoint: "https://x",
      bucket: "b",
      region: "auto",
      accessKeyId: "id",
      secretAccessKey: "secret",
    },
  );
});
