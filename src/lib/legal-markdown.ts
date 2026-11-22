// A small, safe Markdown subset for legal texts (#45): headings (#, ##),
// paragraphs, bullet (-, *) and numbered (1.) lists, **bold** and links
// [text](https://… | mailto:… | tel:…). It produces a tree rendered as
// React elements, never raw HTML, so pasted text cannot inject markup.

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "link"; text: string; href: string };

export type Block =
  | { type: "heading"; level: 2 | 3; content: Inline[] }
  | { type: "paragraph"; content: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] };

const SAFE_HREF = /^(https:\/\/[^\s)]+|mailto:[^\s)]+|tel:\+?[0-9 ()-]+)$/i;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last)
      out.push({ type: "text", text: text.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ type: "strong", text: match[1] });
    else if (SAFE_HREF.test(match[3]))
      out.push({ type: "link", text: match[2], href: match[3] });
    // Unsafe or unsupported link targets keep their text only.
    else out.push({ type: "text", text: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

export function parseLegalMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;
  const flush = () => {
    if (paragraph.length) {
      blocks.push({
        type: "paragraph",
        content: parseInline(paragraph.join(" ")),
      });
      paragraph = [];
    }
    if (list) {
      blocks.push({ type: "list", ...list });
      list = null;
    }
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d{1,3}[.)]\s+(.+)$/.exec(line);
    if (!line) flush();
    else if (heading) {
      flush();
      blocks.push({
        type: "heading",
        level: heading[1].length === 1 ? 2 : 3,
        content: parseInline(heading[2]),
      });
    } else if (bullet || numbered) {
      const ordered = !!numbered;
      if (paragraph.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(parseInline((bullet ?? numbered)![1]));
    } else {
      if (list) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
