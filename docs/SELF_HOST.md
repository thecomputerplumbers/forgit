# Self-hosting forgit

A team deploys one instance into its own Cloudflare account, on its own hostname, and deletes that instance without a shared application tenant.

Git data is in a private R2 bucket. Collaboration metadata is in D1. The worker is the only public HTTP entry. The container runs walgit plus a small helper that shells out to `git` for squash merges.

## One-time account setup

```sh
wrangler login
wrangler r2 bucket create forgit-git
wrangler d1 create forgit
```

Paste the D1 database id into `apps/web/wrangler.jsonc` (`database_id`). Create an R2 API token that can read and write `forgit-git`, and set the S3 endpoint in `services/git/walgit.toml` (`[store.s3].endpoint` looks like `https://<accountid>.r2.cloudflarestorage.com`).

Override the public URL for another hostname with `WALGIT__SERVER__PUBLIC_URL` and `APP_URL`.

## Secrets

Generate two long random values. The same `WALGIT_TOKEN_FORGIT` must be present in the worker and the container. `MERGE_INTERNAL_TOKEN` too. `BETTER_AUTH_SECRET` is only the worker.

```sh
openssl rand -hex 32
```

```sh
cd apps/web
printf '%s' "$BETTER_AUTH_SECRET" | wrangler secret put BETTER_AUTH_SECRET
printf '%s' "$WALGIT_TOKEN_FORGIT" | wrangler secret put WALGIT_TOKEN_FORGIT
printf '%s' "$MERGE_INTERNAL_TOKEN" | wrangler secret put MERGE_INTERNAL_TOKEN
```

Pass `WALGIT_TOKEN_FORGIT`, `MERGE_INTERNAL_TOKEN`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` into the container environment as well. Those are the credentials walgit uses for R2. The worker never talks to R2 directly.

Attach the hostname `git.thecomputerplumbers.com` to this worker (the wrangler route is already a custom domain).

## Migrate and deploy

```sh
pnpm install
pnpm --filter web db:migrate
pnpm --filter web build
cd apps/web && wrangler deploy
```

The container image build compiles pinned walgit `80e9a20b29e29aefd16a4dae6f8e274cce85cca5` from https://github.com/tobi/walgit. The first deploy is slow.

## First organization

Open the site, create an account, and create an organization. The slug is the `{owner}` in clone URLs. Create a repository, then a personal access token under Tokens.

```sh
git -c http.extraHeader="Authorization: Bearer $FORGIT_TOKEN" \
  clone https://git.thecomputerplumbers.com/acme/widget.git
```

Or use the token as the HTTP password with username `git`.

## Health

- `GET /healthz` answers for the worker.
- `GET /readyz` checks D1 and walgit's `/readyz`.
- Replacing the container drops the local cache only. Clone the same repository again to prove R2 still has it.

## What this is not

There is no SSH, no multi-tenant SaaS control plane, and no CI runner. Required checks can still gate merges once something with `checks:write` posts a check run for the exact head SHA.
