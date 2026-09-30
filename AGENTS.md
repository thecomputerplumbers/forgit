# forgit

Cloudflare Worker on Vinext. D1 holds metadata. The `GitContainer` binding runs walgit. Do not store Git objects in D1.

Better Auth is constructed with `lazyAuth` inside a request. Personal access tokens are the machine credential; the browser uses the session cookie.

`pnpm test` is the executable spec for merge policy, authorization, the `gh` subset, and MCP. Live `gh` and Git transport scripts are under `tests/gh` and `tests/git` and need a running instance.

Default branches are unprotected by default, like GitHub. Branch protection is an opt-in repository rule enforced as walgit policy: when on, only the merge helper's `svc:forgit-merge` principal and repository admins may update the default branch, and merges enforce required approvals and checks. Resync the policy with `syncBranchProtection` whenever admins change. File writes and branch creation push as the end user and must not use the merge principal.
