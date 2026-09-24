# Self-hosting forgit

A team deploys one instance into its own Cloudflare account, on its own hostname, and deletes that instance without a shared application tenant.

Git data is in a private R2 bucket. Collaboration metadata is in D1. The worker is the only public HTTP entry. The container runs walgit plus a small helper that shells out to `git` for squash merges.

## One-time account setup

```sh
wrangler login
# Use the account that owns the hostname. This repo targets The Computer Plumbers.
export CLOUDFLARE_ACCOUNT_ID=865d0c927a18e87c0a0701b8d1f18ee9
wrangler r2 bucket create forgit-git
wrangler d1 create forgit
```

The Computer Plumbers account already has D1 `forgit` (`90f47568-e7c5-4802-b9ce-fa7c08d493ed`) and R2 bucket `forgit-git`. Those ids are in `apps/web/wrangler.jsonc`. A different account replaces `account_id`, `database_id`, the route, `APP_URL`, and `R2_ENDPOINT`.

`R2_ENDPOINT` is `https://<accountid>.r2.cloudflarestorage.com`. The worker copies it into the container as `WALGIT__STORE__S3__ENDPOINT`, which overrides `[store.s3].endpoint` in `walgit.toml`.

Create an R2 API token in the dashboard (R2 → Manage API tokens → Object Read & Write, bucket `forgit-git` only). Copy the Access Key ID and Secret Access Key once. The Wrangler OAuth token can create the bucket, and it cannot mint those S3 keys.

## Secrets

Generate three long random values. `BETTER_AUTH_SECRET` stays on the worker. `WALGIT_TOKEN_FORGIT` and `MERGE_INTERNAL_TOKEN` are copied into the container at start. The R2 key pair comes from the dashboard token above.

```sh
openssl rand -hex 32
```

```sh
cd apps/web
printf '%s' "$BETTER_AUTH_SECRET" | wrangler secret put BETTER_AUTH_SECRET
printf '%s' "$WALGIT_TOKEN_FORGIT" | wrangler secret put WALGIT_TOKEN_FORGIT
printf '%s' "$MERGE_INTERNAL_TOKEN" | wrangler secret put MERGE_INTERNAL_TOKEN
printf '%s' "$R2_ACCESS_KEY_ID" | wrangler secret put R2_ACCESS_KEY_ID
printf '%s' "$R2_SECRET_ACCESS_KEY" | wrangler secret put R2_SECRET_ACCESS_KEY
```

`GitContainer` copies those secrets into the container when it starts: `WALGIT_TOKEN_FORGIT`, `MERGE_INTERNAL_TOKEN`, and the R2 pair as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. The worker never talks to R2. Changing a secret requires a new container start before walgit sees it.

### Google sign-in

Create a Google Cloud Web OAuth client with `https://git.thecomputerplumbers.com/api/auth/callback/google` as an authorized redirect URI. A separate client in the same Google Cloud project keeps the Forgit secret independent from the one used by `auth.thecomputerplumbers.com`. The existing client can also work if that redirect URI is added to it, but Forgit must receive its client ID and secret either way.

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Worker secrets using `wrangler secret put` from `apps/web`. The branded button appears on `/sign-in` when both are configured. Google sign-in creates a Forgit account for a new email or links to an existing Forgit account when Google verifies the same email. It does not create or sign in to an account on `auth.thecomputerplumbers.com`.

Attach the hostname `git.thecomputerplumbers.com` to this worker (the wrangler route is already a custom domain).

## Migrate and deploy

```sh
pnpm install
pnpm --filter web db:migrate
pnpm --filter web build
cd apps/web && wrangler deploy --config dist/server/wrangler.json
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
- `GET /readyz` checks D1, walgit's `/readyz`, and a bucket read (`GET /api/v1/owners`). walgit can be up while R2 credentials are wrong; `store` is the check that tells those apart.
- Replacing the container drops the local cache only. Clone the same repository again to prove R2 still has it.

## What this is not

There is no SSH, no multi-tenant SaaS control plane, and no CI runner. Required checks can still gate merges once something with `checks:write` posts a check run for the exact head SHA.
