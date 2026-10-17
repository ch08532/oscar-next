import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function safeLink(url: string): string {
  if (url.startsWith("#")) return url;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password ? parsed.href : "";
  } catch { return ""; }
}

const components: Components = {
  table: ({ children }) => <div className="expert-markdown-table" role="region" aria-label="Analysis table" tabIndex={0}><table>{children}</table></div>,
  a: ({ href, children }) => href
    ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a>
    : <span>{children}</span>,
  // Model-authored images must not trigger tracking requests or leak context.
  img: ({ alt }) => <span>{alt || "[Image omitted]"}</span>,
};
const plugins = [remarkGfm];

export const ExpertMarkdown = memo(function ExpertMarkdown({ text }: { text: string }) {
  return <div className="expert-markdown">
    <Markdown remarkPlugins={plugins} skipHtml urlTransform={safeLink} components={components}>{text}</Markdown>
  </div>;
});
