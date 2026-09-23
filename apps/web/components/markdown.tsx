import type { Element, Root } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { toText } from "hast-util-to-text";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { lowlight } from "../lib/highlight.ts";

type Links = { root: string; dir: string };

/**
 * GitHub-flavored Markdown with inline HTML. Raw HTML is parsed and then run
 * through GitHub's sanitization schema, so repository content cannot run script.
 * `root` is the blob URL prefix for the ref (`/owner/repo/blob/main`) and `dir`
 * is the directory of the rendered file, for resolving relative links.
 */
export function Markdown({ source, root, dir }: { source: string; root: string; dir: string }) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, defaultSchema)
    // After sanitizing: these only add ids, rewrite links, and add highlight spans.
    .use(rehypeSlug)
    .use(() => (tree: Root) => rewrite(tree, { root, dir }));
  const tree = processor.runSync(processor.parse(source)) as Root;
  // Built with jsx() rather than JSX so the module runs under any JSX transform (tests use tsx).
  return jsx("div", {
    className: "markdown",
    children: toJsxRuntime(tree, { Fragment, jsx, jsxs, passKeys: true }),
  });
}

function rewrite(tree: Root, links: Links) {
  const visit = (node: Root | Element, parent: Root | Element | null) => {
    for (const child of node.children) {
      if (child.type === "element") visit(child, node);
    }
    if (node.type !== "element") return;
    if (node.tagName === "a" && typeof node.properties.href === "string") {
      node.properties.href = resolve(node.properties.href, links);
    }
    if (node.tagName === "img" && typeof node.properties.src === "string") {
      const src = node.properties.src;
      if (/^https:\/\//i.test(src)) {
        node.properties.loading = "lazy";
      } else {
        // There is no raw-bytes endpoint, so link to the file page instead of a broken image.
        const label = String(node.properties.alt || src);
        node.tagName = "a";
        node.properties = { href: resolve(src, links) };
        node.children = [{ type: "text", value: label }];
      }
    }
    if (node.tagName === "code" && parent?.type === "element" && parent.tagName === "pre") {
      const language = classList(node)
        .find((name) => name.startsWith("language-"))
        ?.slice("language-".length);
      if (language && lowlight.registered(language)) {
        const highlighted = lowlight.highlight(language, toText(node, { whitespace: "pre" }));
        node.children = highlighted.children as Element["children"];
      }
    }
  };
  visit(tree, null);
}

function classList(node: Element): string[] {
  const value = node.properties.className;
  return Array.isArray(value) ? value.map(String) : [];
}

function resolve(href: string, { root, dir }: Links): string {
  if (/^(https?:|mailto:)/i.test(href) || href.startsWith("#")) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return "#";
  const base = `https://x/${dir ? `${dir}/` : ""}`;
  const url = new URL(href, base);
  return `${root}${url.pathname}${url.hash}`;
}
