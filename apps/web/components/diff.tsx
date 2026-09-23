import { Fragment, type ReactNode } from "react";

import { parsePatch, type DiffFile, type DiffLine } from "@/lib/diff";
import { plural } from "@/lib/format";
import { highlightLines, languageForPath, type Token } from "@/lib/highlight";

import { Tokens } from "./code";
import { CommentableRow } from "./diff-comment";
import { Icon } from "./icons";
import { Badge, EmptyState } from "./ui";

export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  const filled = Math.min(5, total);
  const added = total ? Math.round((additions / total) * filled) : 0;
  const blocks = Array.from({ length: 5 }, (_, index) =>
    index < added ? "add" : index < filled ? "del" : "none",
  );
  return (
    <span className="diffstat">
      <span className="diffstat-add">+{additions}</span>
      <span className="diffstat-del">−{deletions}</span>
      <span aria-hidden="true" className="diffstat-blocks">
        {blocks.map((kind, index) => (
          <i className={kind} key={index} />
        ))}
      </span>
    </span>
  );
}

const STATUS = {
  added: ["Added", "success"],
  removed: ["Deleted", "danger"],
  renamed: ["Renamed", "accent"],
  modified: null,
} as const;

/** Where line comments go and which already exist, keyed by `path:line`. */
export type DiffComments = {
  owner: string;
  repo: string;
  number: number;
  threads: Map<string, ReactNode>;
  /** Show existing threads without offering new comments, for closed or merged pulls. */
  readOnly?: boolean;
};

/**
 * Highlights each side of the file as one document, so multi-line constructs
 * keep their colors, then hands each diff line the tokens for its side.
 */
function highlightFile(file: DiffFile): Map<DiffLine, Token[]> {
  const language = languageForPath(file.path);
  const lines = file.hunks.flatMap((hunk) => hunk.lines);
  const side = (kinds: DiffLine["kind"][]) =>
    highlightLines(
      lines
        .filter((line) => kinds.includes(line.kind))
        .map((line) => line.text)
        .join("\n"),
      language,
    );
  const before = side(["ctx", "del"]);
  const after = side(["ctx", "add"]);
  const tokens = new Map<DiffLine, Token[]>();
  let oldIndex = 0;
  let newIndex = 0;
  for (const line of lines) {
    if (line.kind === "del") tokens.set(line, before[oldIndex++] ?? [{ text: line.text }]);
    else if (line.kind === "add") tokens.set(line, after[newIndex++] ?? [{ text: line.text }]);
    else if (line.kind === "ctx") {
      tokens.set(line, after[newIndex++] ?? [{ text: line.text }]);
      oldIndex += 1;
    } else tokens.set(line, [{ text: line.text }]);
  }
  return tokens;
}

function FileDiff({
  file,
  index,
  comments,
}: {
  file: DiffFile;
  index: number;
  comments?: DiffComments;
}) {
  const status = STATUS[file.status];
  const tokens = highlightFile(file);
  return (
    <details className="diff-file" id={`diff-${index}`} open>
      <summary className="diff-file-head">
        <Icon className="icon diff-chevron" name="chevronDown" />
        <span className="diff-file-name">
          {file.status === "renamed" ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        {status ? <Badge tone={status[1]}>{status[0]}</Badge> : null}
        <DiffStat additions={file.additions} deletions={file.deletions} />
      </summary>
      {file.binary ? (
        <p className="diff-empty">Binary file not shown.</p>
      ) : file.hunks.length === 0 ? (
        <p className="diff-empty">No content changes.</p>
      ) : (
        <div className="diff-scroll">
          <table className="diff-table">
            {file.hunks.map((hunk, hunkIndex) => (
              <tbody key={hunkIndex}>
                {hunk.header !== "@@" ? (
                  <tr className="diff-hunk">
                    <td className="ln" colSpan={2} />
                    <td>{hunk.header}</td>
                  </tr>
                ) : null}
                {hunk.lines.map((line, lineIndex) => {
                  const code = (
                    <td className="diff-code">
                      <span className="diff-sign" aria-hidden="true">
                        {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
                      </span>
                      <Tokens tokens={tokens.get(line) ?? [{ text: line.text }]} />
                    </td>
                  );
                  const thread =
                    comments && line.newNumber !== null
                      ? comments.threads.get(`${file.path}:${line.newNumber}`)
                      : undefined;
                  return (
                    <Fragment key={lineIndex}>
                      {comments && !comments.readOnly && line.newNumber !== null ? (
                        <CommentableRow
                          className={`diff-${line.kind}`}
                          newNumber={line.newNumber}
                          number={comments.number}
                          oldNumber={line.oldNumber}
                          owner={comments.owner}
                          path={file.path}
                          repo={comments.repo}
                        >
                          {code}
                        </CommentableRow>
                      ) : (
                        <tr className={`diff-${line.kind}`}>
                          <td className="ln">{line.oldNumber ?? ""}</td>
                          <td className="ln">{line.newNumber ?? ""}</td>
                          {code}
                        </tr>
                      )}
                      {thread ? (
                        <tr className="diff-thread">
                          <td colSpan={3}>{thread}</td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </details>
  );
}

export function DiffView({ patch, comments }: { patch: string; comments?: DiffComments }) {
  const files = parsePatch(patch);
  if (files.length === 0)
    return (
      <EmptyState icon="diff" title="No changes">
        These refs point at the same content.
      </EmptyState>
    );
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <div className="diff">
      <div className="diff-summary">
        <span>
          Showing <strong>{plural(files.length, "changed file")}</strong> with{" "}
          <span className="diffstat-add">{plural(additions, "addition")}</span> and{" "}
          <span className="diffstat-del">{plural(deletions, "deletion")}</span>
        </span>
      </div>
      {files.length > 1 ? (
        <nav aria-label="Changed files" className="diff-index">
          {files.map((file, index) => (
            <a href={`#diff-${index}`} key={`${file.path}-${index}`}>
              <span>{file.path}</span>
              <DiffStat additions={file.additions} deletions={file.deletions} />
            </a>
          ))}
        </nav>
      ) : null}
      {files.map((file, index) => (
        <FileDiff comments={comments} file={file} index={index} key={`${file.path}-${index}`} />
      ))}
    </div>
  );
}
