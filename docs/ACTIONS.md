# Forgit Actions

Actions uses **`@cloudflare/ci` 0.2.0** for durable Cloudflare Workflows and Sandbox execution. Forgit owns repository workflows, event receipts, permissions, runs, logs, required checks, deployment environments, and repair proposals. New boundary schemas use `zod/mini`, inferred types, and `z.compile`.

## Workflow contract

Commit `.forgit/workflows/ci.yml`:

```yaml
version: 1
name: CI
on: [push, pull_request, workflow_dispatch]
jobs:
  test:
    runs-on: node-26
    timeout-minutes: 15
    steps:
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Test
        run: pnpm test
  build:
    needs: test
    runs-on: node-26
    steps:
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
    artifacts: [dist/report.json]
```

Each job starts with a fresh shallow checkout of the **accepted commit SHA**. Steps share files within a job, run in separate Bash shells with `-e -o pipefail`, and can use `working-directory`. Jobs can run concurrently after `needs` succeeds. Checkout includes `.git`; hooks are disabled. The image pins Node 26.8.2 and pnpm 12.5.1.

Supported triggers: `push`, `pull_request`, and `workflow_dispatch`. Push filters accept `branches` and `tags`; PR filters accept target `branches`. Patterns support `*` and `**`. PRs test the source head, not a synthetic merge commit. PR creation and head changes are reconciled from durable PR rows once per minute. Signed walgit WAL events dispatch pushes without inferring acceptance from HTTP status.

`env` works at workflow, job, and step levels. Only env values support `${{ forgit.sha }}`, `${{ forgit.ref }}`, `${{ forgit.repository }}`, `${{ forgit.run_id }}`, and `${{ secrets.NAME }}`. Shell scripts receive `CI`, `FORGIT_SHA`, `FORGIT_REF`, and `FORGIT_RUN_ID`. Use shell environment variables inside commands; expression interpolation into scripts is rejected.

Limits: 64 KiB YAML, 20 workflow files, 12 jobs, 30 steps per job, 60 minutes per job, 2 MiB of output per step, 32 MiB per artifact, and 10 explicit artifact files per job. Oversized logs fail the job. Global execution admission is four slots, including repair agents; repository concurrency is configurable up to four. Admission or approval waits time out after 30 minutes. The recovery sweep stops active runs after two hours.

This is a documented Actions subset. It does **not** execute marketplace `uses`, matrices, expressions outside env values, GitHub reusable workflows, arbitrary images, LFS/submodules, cross-job artifact downloads, or dependency caches. Rerun means the full workflow at the original SHA. A faster-than-GitHub performance claim has not been established.

## UI, API, and agents

The repository **Actions** tab lists runs and exposes jobs, step logs, artifacts, reruns, cancellation, environment approvals, and agent investigations. Commit and PR checks link to their runs. Settings require repository admin access.

PAT endpoints are under `/api/v3/repos/{owner}/{repo}/actions`:

| Method | Route                                   | Input                                                                           |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------- |
| GET    | `/runs`, `/runs/{id}`                   | Optional `before` cursor for lists                                              |
| POST   | `/runs`                                 | `workflow`, `ref`                                                               |
| POST   | `/runs/{id}/rerun`, `/runs/{id}/cancel` | `{}`                                                                            |
| POST   | `/runs/{id}/approve`                    | `jobId`                                                                         |
| GET    | `/runs/{id}/logs`                       | `job`, `step` query parameters                                                  |
| GET    | `/runs/{id}/artifacts`                  | `name` query parameter                                                          |
| GET    | `/settings`, `/deployments`             | None                                                                            |
| POST   | `/configure`                            | `enabled`, `healing`, `concurrency`, `retentionDays` (partial updates accepted) |
| POST   | `/environment`                          | `name`, `branch`, `requireApproval`                                             |
| POST   | `/secret`                               | `environment`, `name`, `value` (`null` deletes)                                 |
| POST   | `/retry-events`                         | Retry this repository's unprocessed event receipts                              |

Read operations require repository read access. Run, rerun, and cancel require repository write membership plus `workflow:run` for a PAT. Admin operations require admin membership plus `repo:admin`. Scope-limited PATs also need `repo:read` and must include the repository in their restrictions. Browser operations use the session cookie and server actions.

MCP adds `list_action_runs`, `get_action_run`, `get_action_log`, `run_workflow`, `rerun_workflow`, and `cancel_action_run`. Run data includes structured commands, exit codes, timing, dependencies, artifact metadata, and repair outcomes. MCP uses the same authorization checks as the UI/API.

Required-check names are `actions/<workflow filename>/<trigger>`, for example `actions/ci.yml/pull_request`. Only the execution service can produce these checks. External checks cannot use the `actions/` prefix. SQLite triggers project the newest run attempt atomically; late results from older attempts cannot turn a newer failure or queued attempt green.

## Repair loop

Repository admins select **off**, **diagnose**, or **repair**. Workers AI runs `@cf/moonshotai/kimi-k2.7-code` by default. Enabling this sends selected source and redacted failure logs to that model and incurs Workers AI usage.

The loop reads the immutable source and failure evidence, proposes edits, and verifies the original workflow commands in fresh sandboxes. It has 12 model turns, at most two verification attempts, up to 10 existing source files of 32,000 characters each, three minutes per verification command, and a 25-minute Workflow step timeout. Tests, fixtures, configuration, hidden paths, lockfiles, manifests, and symlinks are protected independently of the prompt.

Only verified proposals can reach the internal publisher. The model receives no Git write token or deployment secrets. Publication uses the administrator account that enabled Actions and ordinary Git branch/file operations, never `svc:forgit-merge`. Proposals target `actions/fix/<run id>` and open a PR against the source branch. The publisher rechecks access, repository settings, allowed paths, and the original source head. The original check remains failed; the PR gets normal CI and merge policy. Fix branches cannot recursively invoke the healer. Workflows using deployment environments are excluded entirely.

Changing mode or disabling Actions stops further repair work. An active investigation can also be cancelled. Publication is claimed once before Git writes: an interrupted publisher can leave a partial branch, but it does not blindly repeat writes or open duplicate PRs. Its failure remains visible for an administrator to inspect.

## Deployment environments

Configure an allowed branch and optional administrator approval, then bind a job:

```yaml
on: [push, workflow_dispatch]
jobs:
  deploy:
    runs-on: node-26
    environment: production
    env:
      DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
    steps:
      - run: pnpm install --frozen-lockfile
      - run: pnpm deploy
```

Environment jobs require the current head of the configured branch; PR runs never qualify. Approval is tied to run, job, and environment version, and the approver's permission is rechecked before credentials are released. Environment/secret changes invalidate pending approvals. Only one deployment per environment runs at a time. Deployment intents and outcomes are persisted.

Secrets use AES-GCM with repository/environment/name as authenticated context. Checkout PATs are short-lived, repository-scoped, read-only, tracked by original owner, and revoked on completion/cancellation/recovery. Raw credentials stay inside execution steps, not Workflow step results. Logs mask exact secret values and PAT-shaped strings; this cannot prevent trusted deployment code from deliberately encoding a secret. Give environments appropriately scoped deployment credentials.

Jobs have no automatic command retries. A replay after a recorded job start fails closed. Explicit reruns can repeat external deployment effects, so deployment commands should still use their own idempotency keys (the run ID is provided).

## Install and rollout

Actions is off unless web's `ACTIONS_ENABLED` is `"true"`, and off per repository by default. Existing forgit remains the source of accounts and metadata. No deployment or cloud provisioning is performed by adding these files.

1. Create an R2 bucket `forgit-actions`, a Queue `forgit-actions`, and a dead-letter Queue `forgit-actions-dead`. The committed Wrangler configs bind them. Use separate names when self-hosting multiple installations.
2. Apply `apps/web/migrations/0003_actions.sql` before deploying the new web Worker. Existing checks migrate as external checks.
3. Set `FORGIT_ORIGIN`, `BACKUP_BUCKET_NAME`, and `CLOUDFLARE_ACCOUNT_ID` in the Actions Worker config for your installation. Set web's `APP_URL` and Git configuration consistently.
4. Configure the following secrets without committing their values:

| Worker          | Secret                                     | Purpose                                                                                            |
| --------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| web and actions | `ACTIONS_INTERNAL_TOKEN`                   | Same random service-to-service bearer secret on both Workers                                       |
| web             | `ACTIONS_EVENT_SECRET`                     | Random walgit event signing secret; passed into GitContainer                                       |
| web             | `ACTIONS_ENCRYPTION_KEY`                   | 32 random bytes represented as 64 hex characters; retain for secret decryption                     |
| actions         | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 object read/write credentials restricted to the Actions bucket, for Sandbox snapshot presigning |

5. Deploy `apps/actions` first against the existing `forgit` service, then build/deploy web with its Actions bindings. For a brand-new installation, deploy base forgit before adding the reciprocal Actions service binding. The Sandbox image requires Containers support. AI repair requires the Workers AI binding and paid model access.
6. Set `ACTIONS_ENABLED="true"` on web, then enable one repository in Actions settings. The GitContainer configuration adds the signed WAL event sink and a ten-second sweep. Restart an already-running GitContainer during rollout so its environment picks up the new sink.
7. Push a harmless branch with CI, observe its exact SHA/run/logs, make its Actions check required, and verify a failing PR is blocked. Then enable diagnosis and repair for that repository. Configure a non-production environment before allowing deployments.

Use Wrangler secret input rather than placing credentials in shell command arguments. Encrypting new values with a replacement master key does not re-encrypt old values: changing `ACTIONS_ENCRYPTION_KEY` requires migrating/replacing all stored environment secrets first.

Snapshot R2 credentials belong to the Sandbox service, never workflow env. Configure bucket lifecycle retention for snapshot objects as appropriate; snapshots have one-hour logical TTL. Forgit's cron deletes run logs/artifacts according to repository retention (1–90 days, default 14); run/check metadata remains for audit. Returned raw logs and artifacts require current repository authorization and use `no-store` responses.

## Recovery and verification

Accepted events are committed to D1 before acknowledgement. Duplicate receipts/runs are harmless. Cron retries dispatch using deterministic Workflow IDs, discovers PR events, stops abandoned runs, revokes credentials, and deletes expired outputs. Event processing errors are visible in Actions settings and can be retried there. Queue transport retries use a dead-letter queue. Monitor that queue and walgit's event cursor/retention-gap logs. A WAL retention gap needs an explicit backfill/manual run at the missed revision; this version does not synthesize lost Git history.

For local development, set `ACTIONS_LOCAL=true` on the Actions Worker to use Sandbox's local R2 backup path. Leave it unset in production. The live test creates isolated local SQLite/Git data, a real Wrangler Workflow/Sandbox, and a deterministic model stub; it does not require production credentials or call Workers AI:

```sh
pnpm check
pnpm --filter web build
pnpm --filter actions build
pnpm exec tsx tests/actions/smoke.ts
```

The smoke test covers failure → verified repair PR, a successful run with logs/artifacts/snapshot, and active cancellation. Domain tests cover signatures, event replay, SHA selection, permissions, trusted checks, stale attempts, credential cleanup, deployment eligibility/approval versions, concurrency, and repair publication policy.

### Maintained Cloudflare CI patch

`patches/@cloudflare__ci@0.2.0.patch` exposes the provider/runner types, removes mandatory Artifacts-specific bindings for custom providers, and adds an adapter `createRunner` hook. Forgit still extends and executes upstream `CIWorkflow` and `ci.runner`; it supplies a runner to support exact checkout, per-job credentials, ordered steps, redacted live logs, cancellation, and artifact persistence. The engine still owns durable steps, notifications, failure classification, and snapshot results. Review this small patch whenever upgrading `@cloudflare/ci`; remove it when equivalent upstream hooks are available.

Production Cloudflare resource bindings, real Workers AI repair quality, live walgit event delivery, and comparative speed still require a deployed pilot. Local smoke evidence does not establish those results.
