# forgit

Cloudflare Worker on Vinext. D1 holds metadata. The `GitContainer` binding runs walgit. Do not store Git objects in D1.

Better Auth is constructed with `lazyAuth` inside a request. Personal access tokens are the machine credential; the browser uses the session cookie.

`pnpm test` is the executable spec for merge policy, authorization, the `gh` subset, and MCP. Live `gh` and Git transport scripts are under `tests/gh` and `tests/git` and need a running instance.

Protected default branches are walgit policy. Only the merge helper's `svc:forgit-merge` principal may update them. File writes and branch creation push as the end user and must not use that principal.
