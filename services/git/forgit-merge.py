#!/usr/bin/env python3
"""In-container Git helper. walgit stays on the streaming path; this process only runs git for merge, compare, branch, and file writes."""

import hmac
import json
import os
import re
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$")
PATH = re.compile(r"^[A-Za-z0-9_./-]{1,400}$")
TOKEN = os.environ.get("MERGE_INTERNAL_TOKEN", "")
SERVICE = os.environ.get("WALGIT_TOKEN_FORGIT", "")
ORIGIN = os.environ.get("WALGIT_INTERNAL_ORIGIN", "http://127.0.0.1:8081")
MERGE_PRINCIPAL = "svc:forgit-merge"


def git(args, cwd=None, principal=MERGE_PRINCIPAL):
    command = [
        "git",
        "-c",
        f"http.extraHeader=Authorization: Bearer {SERVICE}",
        "-c",
        f"http.extraHeader=X-Walgit-Principal: {principal}",
        *args,
    ]
    return subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        presented = self.headers.get("Authorization", "")
        expected = f"Bearer {TOKEN}"
        if not TOKEN or not hmac.compare_digest(presented, expected):
            return self.respond(401, {"message": "unauthorized"})
        length = int(self.headers.get("Content-Length", "0"))
        if length > 2_000_000:
            return self.respond(413, {"message": "body too large"})
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self.respond(400, {"message": "invalid json"})
        try:
            if self.path == "/_forgit/merge":
                return self.respond(200, merge(payload))
            if self.path == "/_forgit/compare":
                return self.respond(200, compare(payload))
            if self.path == "/_forgit/branch":
                return self.respond(200, branch(payload))
            if self.path == "/_forgit/file":
                return self.respond(200, write_file(payload))
            return self.respond(404, {"message": "not found"})
        except HelperError as error:
            return self.respond(error.status, {"message": str(error)})

    def respond(self, status, body):
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt, *args):
        print({"event": "merge-helper", "message": fmt % args})


class HelperError(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.status = status


def require_repo(payload):
    owner, repo = payload.get("owner", ""), payload.get("repo", "")
    if not NAME.match(owner) or not NAME.match(repo):
        raise HelperError("invalid repository", 400)
    return owner, repo, f"{ORIGIN}/{owner}/{repo}.git"


def merge(payload):
    owner, repo, url = require_repo(payload)
    base, head = payload.get("base_ref", ""), payload.get("head_ref", "")
    if not REF.match(base) or not REF.match(head):
        raise HelperError("invalid ref", 400)
    work = tempfile.mkdtemp(prefix="forgit-merge-")
    try:
        cloned = git(["clone", "--branch", base, "--single-branch", url, work], principal=MERGE_PRINCIPAL)
        if cloned.returncode != 0:
            raise HelperError(cloned.stderr.strip() or "clone failed", 422)
        fetched = git(["fetch", "origin", head], cwd=work, principal=MERGE_PRINCIPAL)
        if fetched.returncode != 0:
            raise HelperError(fetched.stderr.strip() or "fetch failed", 422)
        actual_base = git(["rev-parse", "HEAD"], cwd=work).stdout.strip()
        actual_head = git(["rev-parse", "FETCH_HEAD"], cwd=work).stdout.strip()
        if actual_base != payload.get("expected_base") or actual_head != payload.get("expected_head"):
            raise HelperError("expected SHAs do not match", 409)
        merged = git(["merge", "--squash", "FETCH_HEAD"], cwd=work, principal=MERGE_PRINCIPAL)
        if merged.returncode != 0:
            raise HelperError(merged.stderr.strip() or "conflict", 409)
        committed = git(
            [
                "-c",
                f"user.name={payload.get('author_name', 'forgit')}",
                "-c",
                f"user.email={payload.get('author_email', 'noreply@forgit.local')}",
                "commit",
                "-m",
                payload.get("message") or "Squash merge",
            ],
            cwd=work,
            principal=MERGE_PRINCIPAL,
        )
        if committed.returncode != 0:
            raise HelperError(committed.stderr.strip() or "commit failed", 422)
        pushed = git(
            ["push", "origin", f"HEAD:refs/heads/{base}", f"--force-with-lease=refs/heads/{base}:{actual_base}"],
            cwd=work,
            principal=MERGE_PRINCIPAL,
        )
        if pushed.returncode != 0:
            raise HelperError(pushed.stderr.strip() or "push rejected", 409)
        sha = git(["rev-parse", "HEAD"], cwd=work).stdout.strip()
        return {"sha": sha}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def compare(payload):
    owner, repo, url = require_repo(payload)
    base, head = payload.get("base", ""), payload.get("head", "")
    if not REF.match(base) or not REF.match(head):
        raise HelperError("invalid ref", 400)
    work = tempfile.mkdtemp(prefix="forgit-compare-")
    try:
        cloned = git(["clone", "--bare", url, work])
        if cloned.returncode != 0:
            raise HelperError("repository not found", 404)
        diff = git(["diff", "--numstat", f"{base}..{head}"], cwd=work)
        patch = git(["diff", "--find-renames", f"{base}..{head}"], cwd=work)
        if diff.returncode != 0 or patch.returncode != 0:
            raise HelperError("refs not found", 404)
        files = []
        for line in diff.stdout.splitlines():
            added, deleted, filename = (line.split("\t") + ["", "", ""])[:3]
            status = "modified"
            if added == "0" and deleted != "0":
                status = "removed"
            elif deleted == "0" and added != "0":
                status = "added"
            files.append({
                "filename": filename,
                "status": status,
                "additions": int(added) if added.isdigit() else 0,
                "deletions": int(deleted) if deleted.isdigit() else 0,
                "patch": "",
            })
        base_sha = git(["rev-parse", base], cwd=work).stdout.strip()
        head_sha = git(["rev-parse", head], cwd=work).stdout.strip()
        merged = git(["merge-tree", "--write-tree", base_sha, head_sha], cwd=work)
        if merged.returncode not in (0, 1):
            raise HelperError(merged.stderr.strip() or "merge check failed", 422)
        return {
            "baseSha": base_sha,
            "headSha": head_sha,
            "mergeable": merged.returncode == 0,
            "files": files,
            "patch": patch.stdout,
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


def user_principal(payload):
    principal = payload.get("principal") or "anonymous"
    if principal == MERGE_PRINCIPAL or not re.match(r"^[A-Za-z0-9_.:@-]{1,200}$", principal):
        raise HelperError("invalid principal", 400)
    return principal


def branch(payload):
    _owner, _repo, url = require_repo(payload)
    name, source = payload.get("branch", ""), payload.get("fromRef", "")
    if not REF.match(name) or not REF.match(source):
        raise HelperError("invalid ref", 400)
    principal = user_principal(payload)
    source_spec = source if re.fullmatch(r"[0-9a-f]{40}", source) else f"refs/heads/{source}"
    work = tempfile.mkdtemp(prefix="forgit-branch-")
    try:
        cloned = git(["clone", "--bare", url, work], principal=principal)
        if cloned.returncode != 0:
            raise HelperError(cloned.stderr.strip() or "clone failed", 422)
        pushed = git(["push", url, f"{source_spec}:refs/heads/{name}"], cwd=work, principal=principal)
        if pushed.returncode != 0:
            raise HelperError(pushed.stderr.strip() or "branch rejected", 422)
        shown = git(["rev-parse", name], cwd=work, principal=principal)
        return {"sha": shown.stdout.strip()}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def write_file(payload):
    owner, repo, url = require_repo(payload)
    branch_name = payload.get("branch", "")
    path = payload.get("path", "")
    if not REF.match(branch_name) or not PATH.match(path) or ".." in path.split("/"):
        raise HelperError("invalid path", 400)
    principal = user_principal(payload)
    work = tempfile.mkdtemp(prefix="forgit-file-")
    try:
        cloned = git(["clone", "--branch", branch_name, "--single-branch", url, work], principal=principal)
        if cloned.returncode != 0:
            raise HelperError(cloned.stderr.strip() or "clone failed", 422)
        target = os.path.join(work, path)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as handle:
            handle.write(payload.get("contents", ""))
        git(["add", "--", path], cwd=work, principal=principal)
        committed = git(
            [
                "-c",
                f"user.name={payload.get('author_name', 'forgit')}",
                "-c",
                f"user.email={payload.get('author_email', 'noreply@forgit.local')}",
                "commit",
                "-m",
                payload.get("message") or f"Update {path}",
            ],
            cwd=work,
            principal=principal,
        )
        if committed.returncode != 0:
            raise HelperError(committed.stderr.strip() or "commit failed", 422)
        pushed = git(["push", "origin", f"HEAD:refs/heads/{branch_name}"], cwd=work, principal=principal)
        if pushed.returncode != 0:
            raise HelperError(pushed.stderr.strip() or "push rejected", 403)
        return {"commit_sha": git(["rev-parse", "HEAD"], cwd=work).stdout.strip()}
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8090), Handler).serve_forever()
