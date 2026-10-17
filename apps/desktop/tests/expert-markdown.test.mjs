import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server, ExpertMarkdown;
before(async () => {
  server = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)),
    appType: "custom", server: { middlewareMode: true }, esbuild: { jsx: "automatic" },
    optimizeDeps: { noDiscovery: true, include: [] } });
  ({ ExpertMarkdown } = await server.ssrLoadModule("/src/components/expert/ExpertMarkdown.tsx"));
});
after(async () => { await server?.close(); });
const render = text => renderToStaticMarkup(createElement(ExpertMarkdown, { text }));

test("Expert renders Markdown headings, emphasis, lists, code and GFM tables", () => {
  const html = render("### Synthetic summary\n\n**Measured value** and *explanation*.\n\n| Metric | Value |\n| --- | --- |\n| Example | 2 |\n\n- First\n- Second\n\n1. Step one\n2. Step two\n\n> Uncertain observation\n\n`inline`\n\n```text\nexample\n```");
  for (const markup of ["<h3>Synthetic summary</h3>", "<strong>Measured value</strong>", "<em>explanation</em>", "<table>", "<th>Metric</th>", "<td>Example</td>", "<ul>", "<ol>", "<blockquote>", "<code>inline</code>", "<pre>"]) assert.ok(html.includes(markup), markup);
  assert.ok(html.includes('aria-label="Analysis table"'));
});

test("Expert Markdown blocks HTML, unsafe navigation and image loads", () => {
  const html = render('<script>alert(1)</script>\n\n<img src="https://example.invalid/pixel">\n\n[bad](javascript:alert) [file](file:///secret) [relative](/api/v1) [encoded](jav&#x61;script:alert)\n\n![Image description](https://example.invalid/pixel)\n\n[Source](https://example.org/reference)');
  assert.doesNotMatch(html, /<script|<img|javascript:|file:\/\/|href="\/api|src=/i);
  assert.ok(html.includes("Image description"));
  assert.ok(html.includes('href="https://example.org/reference"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('referrerPolicy="no-referrer"'));
});

test("Expert Markdown accepts incomplete streamed formatting and formats the completed text", () => {
  for (const partial of ["**Meas", "| Metric | Value |\n| ---", "```text\npartial", "[Source](https://"]) assert.equal(typeof render(partial), "string");
  const html = render("**Measured**\n\n| Metric | Value |\n| --- | --- |\n| Example | 2 |");
  assert.ok(html.includes("<strong>Measured</strong>"));
  assert.equal((html.match(/<table>/g) ?? []).length, 1);
});
