// Where product media bytes live (#44): in product_media.content
// (MEDIA_STORAGE=database, the default, no extra service) or in an
// S3-compatible bucket (MEDIA_STORAGE=s3: Cloudflare R2, AWS S3, MinIO).
// The bucket can stay private: shoppers get images through /media/<id>,
// which a CDN in front of the shop caches (immutable per id).
import { createS3Storage, s3ConfigFromEnv, type S3Storage } from "./s3-storage";

export type MediaDriver = "database" | "s3";

export function mediaDriver(value = process.env.MEDIA_STORAGE): MediaDriver {
  if (!value || value === "database") return "database";
  if (value === "s3") return "s3";
  throw new Error(`MEDIA_STORAGE must be "database" or "s3", got "${value}".`);
}

const globalStorage = globalThis as typeof globalThis & { mediaS3?: S3Storage };

function s3(): S3Storage {
  return (globalStorage.mediaS3 ??= createS3Storage(s3ConfigFromEnv()));
}

/** Test hook: use this storage instead of the one from the environment. */
export function setMediaS3ForTests(storage: S3Storage | undefined) {
  globalStorage.mediaS3 = storage;
}

/** Bucket key of a media file: grouped by product, unique by id. */
export const mediaKey = (sku: string, id: string) =>
  `products/${sku.replace(/[^A-Za-z0-9._-]/g, "_")}/${id}`;

/**
 * Stores the bytes for a new product_media row and returns the column
 * values to insert. With S3 the object is uploaded first; if the database
 * insert then fails, call discardStoredMedia with the result.
 */
export async function storeMedia(
  sku: string,
  id: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ content: Uint8Array | null; storageKey: string | null }> {
  if (mediaDriver() === "database") return { content: bytes, storageKey: null };
  const key = mediaKey(sku, id);
  await s3().put(key, bytes, contentType);
  return { content: null, storageKey: key };
}

/** The bytes of a product_media row, wherever they are stored. */
export async function readMedia(row: {
  content: Uint8Array | null;
  storage_key: string | null;
}): Promise<Uint8Array | null> {
  if (row.content) return row.content;
  if (!row.storage_key) return null;
  return s3().get(row.storage_key);
}

/**
 * Removes a stored object after its row is gone (or was never written).
 * Best effort: a failure leaves an orphan object, logged for cleanup.
 */
export async function discardStoredMedia(storageKey: string | null) {
  if (!storageKey) return;
  try {
    await s3().delete(storageKey);
  } catch (error) {
    console.error("Media object left in storage", storageKey, error);
  }
}
