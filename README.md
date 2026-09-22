# forgit

Self-hostable Git for a small team, on Cloudflare.

forgit is the part of a forge people actually use: repositories, HTTPS clone and push, pull requests, a small browser, a `gh`-shaped API, and a GitHub-shaped MCP endpoint. It is not a GitHub clone. Git objects live in [walgit](https://github.com/tobi/walgit) on R2. Users, permissions, pull requests, reviews, checks, and tokens live in D1.

The reference hostname is `git.thecomputerplumbers.com`.

```text
https://git.example.com/                         repositories
https://git.example.com/{owner}/{repo}.git        Git Smart HTTP
https://git.example.com/api/v3/...                GitHub-compatible REST subset
https://git.example.com/api/graphql               GraphQL subset used by gh pr
https://git.example.com/mcp                       MCP Streamable HTTP
```

HTTPS only. SSH and `git://` are out of scope.

## Layout

```text
apps/web            Vinext UI, Better Auth, Worker edge
services/git        walgit container, nginx stream proxy, merge helper
packages/domain     repositories, pull requests, merge policy
packages/db         D1 schema and SQL store
packages/git-client walgit adapter and path classification
packages/github-compat
packages/mcp
```

## Develop

Requires Node.js 26 and pnpm 12 (`mise trust && mise install`).

```sh
pnpm install
pnpm test
pnpm --filter web dev
```

Point `WALGIT_URL` at a local walgit if you want the UI to read real repositories. The default test suite uses an in-memory Git store and does not need Cloudflare.

## Deploy

See [docs/SELF_HOST.md](docs/SELF_HOST.md). Decisions that closed the plan's open questions are in [docs/DECISIONS.md](docs/DECISIONS.md). The `gh` command matrix is in [docs/GH_COMPAT.md](docs/GH_COMPAT.md).

## License

Forgit is dual-licensed. Choose either:

- **AGPL-3.0-or-later**, in [LICENSE](LICENSE), for the complete open-source
  version; or
- the **Forgit Commercial License**, currently **$99 per legal entity per
  year**, for the same code without the AGPL source-sharing requirements.

The commercial license has no seat, repository, server, or installation limits,
and versions received during an active subscription remain licensed after the
subscription ends. See [Licensing Forgit](docs/LICENSING.md) for the plain-language
guide and [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md) for the commercial
terms.
