import type { Element, ElementContent, Root } from "hast";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import elixir from "highlight.js/lib/languages/elixir";
import haskell from "highlight.js/lib/languages/haskell";
import nginx from "highlight.js/lib/languages/nginx";
import powershell from "highlight.js/lib/languages/powershell";
import protobuf from "highlight.js/lib/languages/protobuf";
import scala from "highlight.js/lib/languages/scala";
import { common, createLowlight } from "lowlight";

export const lowlight = createLowlight({
  ...common,
  dockerfile,
  elixir,
  haskell,
  nginx,
  powershell,
  protobuf,
  scala,
});

/** Beyond this, highlighting costs more than it helps. */
const MAX_CHARS = 250_000;

const FILENAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  gemfile: "ruby",
  rakefile: "ruby",
  "nginx.conf": "nginx",
  ".gitignore": "bash",
  ".env": "bash",
};

const EXTENSIONS: Record<string, string> = {
  jsonc: "json",
  json5: "json",
  svg: "xml",
  vue: "xml",
  svelte: "xml",
  tf: "ini",
  lock: "yaml",
  mdx: "markdown",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
};

/** The highlight.js language for a file path, or null when none fits. */
export function languageForPath(path: string): string | null {
  const name = (path.split("/").at(-1) ?? "").toLowerCase();
  if (FILENAMES[name]) return FILENAMES[name];
  if (name.startsWith("dockerfile.")) return "dockerfile";
  const extension = name.includes(".") ? (name.split(".").at(-1) ?? "") : "";
  if (!extension) return null;
  const mapped = EXTENSIONS[extension] ?? extension;
  return lowlight.registered(mapped) ? mapped : null;
}

/** A run of text and the highlight classes that apply to it. */
export type Token = { text: string; className?: string };

/**
 * Highlights code and splits the result into lines of tokens, so a token that
 * spans lines (a block comment, a template string) keeps its class on each line.
 */
export function highlightLines(code: string, language: string | null): Token[][] {
  const plain = () => code.split("\n").map((line) => [{ text: line }]);
  if (!language || code.length > MAX_CHARS || !lowlight.registered(language)) return plain();
  let tree: Root;
  try {
    tree = lowlight.highlight(language, code);
  } catch {
    return plain();
  }
  const lines: Token[][] = [[]];
  const walk = (nodes: ElementContent[] | Root["children"], classes: string[]) => {
    for (const node of nodes) {
      if (node.type === "text") {
        const parts = node.value.split("\n");
        parts.forEach((part, index) => {
          if (index > 0) lines.push([]);
          if (part) {
            const className = classes.length ? classes.join(" ") : undefined;
            lines.at(-1)?.push(className ? { text: part, className } : { text: part });
          }
        });
      } else if (node.type === "element") {
        walk(node.children, [...classes, ...classNames(node)]);
      }
    }
  };
  walk(tree.children, []);
  return lines;
}

function classNames(node: Element): string[] {
  const value = node.properties.className;
  return Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];
}
