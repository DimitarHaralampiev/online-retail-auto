export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_PRODUCT_FILES = 12;
export const MAX_PRODUCT_BYTES = 100 * 1024 * 1024;
export function inspectProductMedia(bytes: Buffer, mime: string) {
  const image = ["image/jpeg", "image/png", "image/webp"].includes(mime);
  const video = ["video/mp4", "video/webm"].includes(mime);
  if (!image && !video) throw Error("Избери JPG, PNG, WebP, MP4 или WebM.");
  if (
    bytes.length < 12 ||
    bytes.length > (image ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES)
  )
    throw Error("Снимките са до 10 MB, а видеата до 50 MB.");
  let valid = false;
  if (mime === "image/jpeg")
    valid = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/png")
    valid = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/webp")
    valid =
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP";
  if (mime === "video/mp4")
    valid =
      bytes.toString("ascii", 4, 8) === "ftyp" &&
      ["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "MSNV", "dash"].includes(
        bytes.toString("ascii", 8, 12),
      );
  if (mime === "video/webm")
    valid =
      bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) &&
      bytes.subarray(0, 4096).includes(Buffer.from("webm"));
  if (!valid)
    throw Error("Съдържанието не съответства на избрания файлов формат.");
  return image ? "image" : "video";
}
export function mediaFilename(name: string) {
  return (
    name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 180) || "product-media"
  );
}
export function parseMediaRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end = match[1]
    ? match[2]
      ? Math.min(Number(match[2]), size - 1)
      : size - 1
    : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return null;
  return { start, end };
}
