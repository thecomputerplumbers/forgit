# Forgit Cloud deployment

`forgit.cloud` is the hosted private preview. It is separate from the private
`git.thecomputerplumbers.com` installation. The `cloud` Wrangler environment
uses the `forgit-cloud` web Worker and `forgit-actions-cloud` Actions Worker,
with separate D1, R2 buckets, queue, Workflow, and Containers. Git objects are
stored in `forgit-cloud-git`, never D1.

## Deploy

From the repository root:

```sh
pnpm exec wrangler d1 migrations apply DB --remote --env cloud --config apps/web/wrangler.jsonc
pnpm exec wrangler deploy --env cloud --config apps/actions/wrangler.jsonc
CLOUDFLARE_ENV=cloud pnpm --filter web build
pnpm exec wrangler deploy --config apps/web/dist/server/wrangler.json
```

The web build generates a flattened Cloudflare config. Deploy that generated
file without `--env`; passing `--env cloud` to it selects a nonexistent nested
environment. For a new installation, deploy the base web Worker before the
Actions Worker, then restore the reciprocal web service binding and deploy web
again.

Required web secrets are `BETTER_AUTH_SECRET`, `WALGIT_TOKEN_FORGIT`,
`MERGE_INTERNAL_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`ACTIONS_INTERNAL_TOKEN`, `ACTIONS_EVENT_SECRET`, and
`ACTIONS_ENCRYPTION_KEY`. The two R2 keys must be limited to the hosted Git
bucket. The Actions Worker needs the same `ACTIONS_INTERNAL_TOKEN` and its own
R2 key pair limited to `forgit-cloud-actions`. Set secrets on the correct
Worker/environment; never commit their values.

Initialize the first organization on the hosted database with:

```sh
pnpm --filter web run init --remote --env cloud --email owner@example.com --name "Owner Name" --organization "Company Name" --slug company
```

The command refuses to initialize a database that already has an organization.
Public signup remains disabled. The hosted plans displayed on the landing page
are proposed prices; checkout, Metronome metering, and billing activation are
still pending. See [HOSTED_BILLING.md](HOSTED_BILLING.md).

## Verify

`https://forgit.cloud/healthz` checks the Worker and `/readyz` checks D1,
walgit, and object storage. Plain HTTP should redirect to HTTPS. Confirm
`/sign-up` says signups are closed. A real Actions run requires an initialized
organization, a repository workflow, and a push or manual dispatch; readiness
alone does not prove the run path.
