import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { Markdown } from "../apps/web/components/markdown.tsx";
import { parsePatch } from "../apps/web/lib/diff.ts";
import { formatBytes, initials, timeAgo } from "../apps/web/lib/format.ts";
import { highlightLines, languageForPath } from "../apps/web/lib/highlight.ts";

describe("patch parsing", () => {
  it("numbers context, added, and removed lines per file", () => {
    const files = parsePatch(
      [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 1111111..2222222 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -3,3 +3,3 @@ export function main() {",
        " const a = 1;",
        "-const b = 2;",
        "+const b = 3;",
        " return a + b;",
        "diff --git a/NEW.md b/NEW.md",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/NEW.md",
        "@@ -0,0 +1 @@",
        "+hello",
        "\\ No newline at end of file",
        "",
      ].join("\n"),
    );
    assert.equal(files.length, 2);
    const [app, added] = files;
    assert.equal(app?.status, "modified");
    assert.equal(app?.additions, 1);
    assert.equal(app?.deletions, 1);
    assert.deepEqual(
      app?.hunks[0]?.lines.map((line) => [line.kind, line.oldNumber, line.newNumber]),
      [
        ["ctx", 3, 3],
        ["del", 4, null],
        ["add", null, 4],
        ["ctx", 5, 5],
      ],
    );
    assert.equal(added?.status, "added");
    assert.equal(added?.hunks[0]?.lines.at(-1)?.kind, "note");
  });

  it("recognizes renames, deletions, and binary files", () => {
    const files = parsePatch(
      [
        "diff --git a/old.txt b/new.txt",
        "similarity index 100%",
        "rename from old.txt",
        "rename to new.txt",
        "diff --git a/gone.txt b/gone.txt",
        "deleted file mode 100644",
        "--- a/gone.txt",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-bye",
        "diff --git a/logo.png b/logo.png",
        "Binary files a/logo.png and b/logo.png differ",
      ].join("\n"),
    );
    assert.deepEqual(
      files.map((file) => [file.path, file.status, file.binary]),
      [
        ["new.txt", "renamed", false],
        ["gone.txt", "removed", false],
        ["logo.png", "modified", true],
      ],
    );
  });

  it("returns nothing for an empty patch", () => {
    assert.deepEqual(parsePatch(""), []);
  });
});

describe("view formatting", () => {
  it("describes elapsed time", () => {
    const now = Date.parse("2026-01-10T12:00:00Z");
    assert.equal(timeAgo(now - 30_000, now), "just now");
    assert.equal(timeAgo(now - 3 * 3_600_000, now), "3 hours ago");
    assert.equal(timeAgo("2026-01-09T12:00:00Z", now), "yesterday");
  });

  it("formats sizes and initials", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2.0 KB");
    assert.equal(initials("Ada Lovelace"), "AL");
    assert.equal(initials("octocat"), "OC");
  });
});

describe("syntax highlighting", () => {
  it("picks a language from the extension or file name", () => {
    assert.equal(languageForPath("src/app.tsx"), "tsx");
    assert.equal(languageForPath("services/git/Dockerfile"), "dockerfile");
    assert.equal(languageForPath("LICENSE"), null);
    assert.equal(languageForPath("notes.unknownext"), null);
  });

  it("keeps a multi-line comment's class on every line", () => {
    const lines = highlightLines("/* one\ntwo */\nconst x = 1;", "typescript");
    assert.equal(lines.length, 3);
    assert.match(lines[0]?.[0]?.className ?? "", /hljs-comment/);
    assert.match(lines[1]?.[0]?.className ?? "", /hljs-comment/);
    assert.ok(lines[2]?.some((token) => token.className?.includes("hljs-keyword")));
    assert.equal(
      lines.map((line) => line.map((token) => token.text).join("")).join("\n"),
      "/* one\ntwo */\nconst x = 1;",
    );
  });

  it("falls back to plain lines without a language", () => {
    assert.deepEqual(highlightLines("a\nb", null), [[{ text: "a" }], [{ text: "b" }]]);
  });
});

describe("markdown", () => {
  const render = (source: string) =>
    renderToStaticMarkup(Markdown({ source, root: "/acme/widget/blob/main", dir: "docs" }));

  it("renders GitHub-flavored markdown with nested lists and tables", () => {
    const html = render("- a\n  - nested\n- [x] done\n\n| h |\n| - |\n| c |\n\n~~gone~~");
    assert.match(html, /<li>a\s*<ul>\s*<li>nested<\/li>/);
    assert.match(html, /type="checkbox"/);
    assert.match(html, /<table>/);
    assert.match(html, /<del>gone<\/del>/);
  });

  it("keeps safe inline HTML and strips script and handlers", () => {
    const html = render(
      '<div align="center"><img src="https://example.com/a.png" onerror="alert(1)"></div>\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))',
    );
    assert.match(html, /align="center"/);
    assert.doesNotMatch(html, /onerror|<script|javascript:/);
  });

  it("resolves relative links and turns relative images into links", () => {
    const html = render("[guide](../README.md#intro) ![logo](logo.png)");
    assert.match(html, /href="\/acme\/widget\/blob\/main\/README.md#intro"/);
    assert.match(html, /<a href="\/acme\/widget\/blob\/main\/docs\/logo.png">logo<\/a>/);
  });

  it("highlights fenced code", () => {
    assert.match(render("```ts\nconst a = 1;\n```"), /hljs-keyword/);
  });
});
