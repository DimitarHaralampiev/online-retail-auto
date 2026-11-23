// Renders structured data for search engines; see src/lib/structured-data.ts.
// A JSON-LD block is data, not code: browsers never execute it, so the
// script-src CSP (src/proxy.ts) does not apply and it needs no nonce.
import { jsonLdScript } from "../lib/structured-data";

export default function JsonLd({
  data,
}: {
  data: Record<string, unknown> | Record<string, unknown>[];
}) {
  return (
    <script
      type="application/ld+json"
      // Safe: jsonLdScript escapes "<", so the content cannot end the tag.
      dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
    />
  );
}
