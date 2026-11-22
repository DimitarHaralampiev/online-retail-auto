// Renders a legal text from the safe Markdown subset (src/lib/legal-markdown.ts)
// as React elements: no raw HTML ever reaches the page.
import { parseLegalMarkdown, type Inline } from "../lib/legal-markdown";

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.type === "strong" ? (
          <strong key={index}>{part.text}</strong>
        ) : part.type === "link" ? (
          <a
            key={index}
            href={part.href}
            rel="noopener noreferrer"
            target={part.href.startsWith("https:") ? "_blank" : undefined}
          >
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

export default function LegalText({ source }: { source: string }) {
  return (
    <div className="legal-text">
      {parseLegalMarkdown(source).map((block, index) => {
        if (block.type === "heading")
          return block.level === 2 ? (
            <h2 key={index}>
              <Inlines parts={block.content} />
            </h2>
          ) : (
            <h3 key={index}>
              <Inlines parts={block.content} />
            </h3>
          );
        if (block.type === "list") {
          const items = block.items.map((item, i) => (
            <li key={i}>
              <Inlines parts={item} />
            </li>
          ));
          return block.ordered ? (
            <ol key={index}>{items}</ol>
          ) : (
            <ul key={index}>{items}</ul>
          );
        }
        return (
          <p key={index}>
            <Inlines parts={block.content} />
          </p>
        );
      })}
    </div>
  );
}
