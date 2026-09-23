"use client";

import { useState, type ReactNode } from "react";

import { commentAction } from "@/app/actions";

import { Icon } from "./icons";

/** A diff line whose gutter button opens an inline comment form below it. */
export function CommentableRow({
  className,
  oldNumber,
  newNumber,
  path,
  owner,
  repo,
  number,
  children,
}: {
  className: string;
  oldNumber: number | null;
  newNumber: number;
  path: string;
  owner: string;
  repo: string;
  number: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={className}>
        <td className="ln">{oldNumber ?? ""}</td>
        <td className="ln ln-comment">
          <button
            aria-label={`Comment on line ${newNumber}`}
            className="line-comment-button"
            onClick={() => setOpen(true)}
            type="button"
          >
            <Icon name="plus" size={12} />
          </button>
          {newNumber}
        </td>
        {children}
      </tr>
      {open ? (
        <tr className="diff-thread">
          <td colSpan={3}>
            <form action={commentAction} className="thread-form">
              <input name="owner" type="hidden" value={owner} />
              <input name="repo" type="hidden" value={repo} />
              <input name="number" type="hidden" value={number} />
              <input name="path" type="hidden" value={path} />
              <input name="line" type="hidden" value={newNumber} />
              <textarea
                aria-label={`Comment on ${path} line ${newNumber}`}
                autoFocus
                name="body"
                placeholder={`Comment on line ${newNumber}`}
                required
                rows={3}
              />
              <div className="form-actions">
                <button className="btn btn-sm btn-primary" type="submit">
                  Add comment
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}
