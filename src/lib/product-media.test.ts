import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectProductMedia,
  parseMediaRange,
  mediaFilename,
  MAX_IMAGE_BYTES,
} from "./product-media-rules";
test("media rejects active formats and forged MIME types", () => {
  assert.throws(() =>
    inspectProductMedia(Buffer.from("<svg>123456789</svg>"), "image/svg+xml"),
  );
  assert.throws(() =>
    inspectProductMedia(
      Buffer.from("<script>123456789</script>"),
      "image/jpeg",
    ),
  );
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(20),
  ]);
  assert.equal(inspectProductMedia(png, "image/png"), "image");
  assert.throws(() =>
    inspectProductMedia(Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/png"),
  );
  const mp4 = Buffer.alloc(24);
  mp4.write("ftyp", 4);
  mp4.write("isom", 8);
  assert.equal(inspectProductMedia(mp4, "video/mp4"), "video");
  mp4.write("avif", 8);
  assert.throws(() => inspectProductMedia(mp4, "video/mp4"));
});
test("video ranges support seek and suffix and reject impossible/multiple ranges", () => {
  assert.deepEqual(parseMediaRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseMediaRange("bytes=-4", 10), { start: 6, end: 9 });
  assert.deepEqual(parseMediaRange("bytes=5-", 10), { start: 5, end: 9 });
  for (const range of [
    "bytes=10-",
    "bytes=7-2",
    "bytes=1-2,5-6",
    "bytes=-0",
    "bytes=-",
  ])
    assert.equal(parseMediaRange(range, 10), null);
});
test("uploaded filenames cannot inject paths or header control characters", () => {
  assert.equal(mediaFilename("../a\r\n.jpg"), ".._a__.jpg");
});
