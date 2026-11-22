// S3-compatible object storage (AWS S3, Cloudflare R2, MinIO) over HTTP
// with SigV4 signing (aws4fetch). Path-style URLs: <endpoint>/<bucket>/<key>.
import { AwsClient } from "aws4fetch";

export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function s3ConfigFromEnv(
  env: Partial<Record<string, string>> = process.env,
): S3Config {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`MEDIA_STORAGE=s3 requires ${name}.`);
    return value;
  };
  return {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    bucket: required("S3_BUCKET"),
    // R2 accepts "auto"; AWS needs the bucket's region.
    region: env.S3_REGION?.trim() || "auto",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  };
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,500}$/;

export function createS3Storage(
  config: S3Config,
  fetcher: typeof fetch = fetch,
) {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: "s3",
  });
  const url = (key: string) => {
    if (!KEY.test(key) || key.includes(".."))
      throw new Error("Invalid storage key.");
    return `${config.endpoint}/${encodeURIComponent(config.bucket)}/${key
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  };
  const send = async (key: string, init: RequestInit) => {
    const signed = await client.sign(url(key), init);
    return fetcher(signed);
  };
  return {
    async put(key: string, body: Uint8Array, contentType: string) {
      const response = await send(key, {
        method: "PUT",
        // A copy in a plain ArrayBuffer, the type fetch bodies accept.
        body: new Uint8Array(body),
        headers: { "Content-Type": contentType },
      });
      if (!response.ok)
        throw new Error(
          `Object storage refused the upload (${response.status}).`,
        );
    },
    async get(key: string): Promise<Uint8Array | null> {
      const response = await send(key, { method: "GET" });
      if (response.status === 404) return null;
      if (!response.ok)
        throw new Error(`Object storage read failed (${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    },
    async delete(key: string) {
      const response = await send(key, { method: "DELETE" });
      // Deleting a missing object is not an error (S3 answers 204 anyway).
      if (!response.ok && response.status !== 404)
        throw new Error(`Object storage delete failed (${response.status}).`);
    },
  };
}

export type S3Storage = ReturnType<typeof createS3Storage>;
