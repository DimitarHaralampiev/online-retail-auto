import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { GET } from "../../src/app/media/[id]/route";
import { createPostgresCatalog } from "../../src/lib/catalog-postgres";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import {
  discardStoredMedia,
  readMedia,
  setMediaS3ForTests,
  storeMedia,
} from "../../src/lib/media-storage";
import type { S3Storage } from "../../src/lib/s3-storage";
import { setupTestDatabase } from "./database";

const db = setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
  },
});

// An in-memory stand-in for an S3-compatible bucket.
const bucket = new Map<string, Uint8Array>();
const fakeS3: S3Storage = {
  async put(key, body) {
    bucket.set(key, body);
  },
  async get(key) {
    return bucket.get(key) ?? null;
  },
  async delete(key) {
    bucket.delete(key);
  },
};
after(() => {
  setMediaS3ForTests(undefined);
  delete process.env.MEDIA_STORAGE;
});

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

async function insertMedia(
  sku: string,
  kind: "image" | "video",
  primary: boolean,
): Promise<string> {
  const id = randomUUID();
  const stored = await storeMedia(
    sku,
    id,
    PNG,
    kind === "image" ? "image/png" : "video/mp4",
  );
  await db().pool.query(
    `INSERT INTO product_media(id,sku,kind,mime_type,filename,content,storage_key,byte_size,sort_order,is_primary)
     VALUES($1,$2,$3,$4,'f',$5,$6,$7,0,$8)`,
    [
      id,
      sku,
      kind,
      kind === "image" ? "image/png" : "video/mp4",
      stored.content,
      stored.storageKey,
      PNG.length,
      primary,
    ],
  );
  return id;
}

const get = (id: string, headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/media/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });

test("database storage: bytes in the row, served publicly with long caching", async () => {
  delete process.env.MEDIA_STORAGE;
  const id = await insertMedia("DEMO-003", "image", true);
  const row = (
    await db().pool.query(
      "SELECT content, storage_key FROM product_media WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(row.storage_key, null);
  assert.deepEqual([...(await readMedia(row))!], [...PNG]);
  const response = await get(id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...PNG]);
  const cached = await get(id, { "if-none-match": `"${id}"` });
  assert.equal(cached.status, 304);
});

test("the primary uploaded image becomes the storefront image", async () => {
  const product = await createPostgresCatalog(() => db().pool).getProduct(
    "DEMO-003",
  );
  assert.match(product!.image, /^\/media\/[0-9a-f-]{36}$/);
  const other = await createPostgresCatalog(() => db().pool).getProduct(
    "DEMO-001",
  );
  assert.doesNotMatch(other!.image, /^\/media\//);
});

test("object storage: bytes in the bucket, none in the row", async () => {
  process.env.MEDIA_STORAGE = "s3";
  setMediaS3ForTests(fakeS3);
  const id = await insertMedia("DEMO-004", "image", true);
  const row = (
    await db().pool.query(
      "SELECT content, storage_key FROM product_media WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(row.content, null);
  assert.equal(row.storage_key, `products/DEMO-004/${id}`);
  assert.ok(bucket.has(row.storage_key));
  const response = await get(id);
  assert.equal(response.status, 200);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...PNG]);
  await discardStoredMedia(row.storage_key);
  assert.ok(!bucket.has(row.storage_key));
  // A missing object reads as not found, not as an error.
  assert.equal((await get(id)).status, 404);
});

test("videos, drafts and malformed ids are not public", async () => {
  delete process.env.MEDIA_STORAGE;
  const video = await insertMedia("DEMO-005", "video", false);
  assert.equal((await get(video)).status, 404);
  const draftImage = await insertMedia("DEMO-006", "image", true);
  await db().pool.query(
    "UPDATE warehouse_products SET status='draft' WHERE sku='DEMO-006'",
  );
  assert.equal((await get(draftImage)).status, 404);
  assert.equal((await get("not-a-uuid")).status, 404);
  assert.equal((await get(randomUUID())).status, 404);
});

test("a row stores its bytes exactly once", async () => {
  await assert.rejects(
    db().pool.query(
      `INSERT INTO product_media(id,sku,kind,mime_type,filename,content,storage_key,byte_size)
       VALUES($1,'DEMO-001','image','image/png','f',$2,'products/x/y',12)`,
      [randomUUID(), PNG],
    ),
    (e: { code?: string }) => e.code === "23514",
  );
  await assert.rejects(
    db().pool.query(
      `INSERT INTO product_media(id,sku,kind,mime_type,filename,content,storage_key,byte_size)
       VALUES($1,'DEMO-001','image','image/png','f',NULL,NULL,12)`,
      [randomUUID()],
    ),
    (e: { code?: string }) => e.code === "23514",
  );
});
