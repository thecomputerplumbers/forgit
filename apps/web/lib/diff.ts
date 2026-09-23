export type DiffLine = {
  kind: "add" | "del" | "ctx" | "note";
  oldNumber: number | null;
  newNumber: number | null;
  text: string;
};

export type DiffHunk = { header: string; lines: DiffLine[] };

export type DiffFile = {
  path: string;
  oldPath: string;
  status: "added" | "removed" | "modified" | "renamed";
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
};

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

/** Splits a unified `git diff` into files, hunks, and numbered lines. */
export function parsePatch(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      const oldPath = match?.[1] ?? line.slice(11);
      const path = match?.[2] ?? oldPath;
      file = {
        path,
        oldPath,
        status: oldPath === path ? "modified" : "renamed",
        binary: false,
        additions: 0,
        deletions: 0,
        hunks: [],
      };
      hunk = null;
      files.push(file);
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (line.startsWith("new file mode")) file.status = "added";
      else if (line.startsWith("deleted file mode")) file.status = "removed";
      else if (line.startsWith("Binary files") || line.startsWith("GIT binary patch"))
        file.binary = true;
      else if (line.startsWith("--- /dev/null")) file.status = "added";
      else if (line.startsWith("+++ /dev/null")) file.status = "removed";
    }
    if (line.startsWith("@@")) {
      const match = HUNK.exec(line);
      oldLine = Number(match?.[1] ?? 1);
      newLine = Number(match?.[2] ?? 1);
      hunk = { header: match ? line : "@@", lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("+")) {
      hunk.lines.push({ kind: "add", oldNumber: null, newNumber: newLine++, text: line.slice(1) });
      file.additions += 1;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ kind: "del", oldNumber: oldLine++, newNumber: null, text: line.slice(1) });
      file.deletions += 1;
    } else if (line.startsWith("\\")) {
      hunk.lines.push({ kind: "note", oldNumber: null, newNumber: null, text: line.slice(2) });
    } else if (line.startsWith(" ")) {
      hunk.lines.push({
        kind: "ctx",
        oldNumber: oldLine++,
        newNumber: newLine++,
        text: line.slice(1),
      });
    }
  }
  return files;
}
