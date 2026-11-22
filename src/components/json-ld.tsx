// Renders structured data for search engines; see src/lib/structured-data.ts.
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
