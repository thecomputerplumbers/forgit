import { env } from "cloudflare:workers";
import { actionOperation } from "@/app/actions-ci";
import { ActionFields } from "@/components/actions";
import { RepoHeader } from "@/components/repo";
import { Shell } from "@/components/shell";
import { Alert, Box, Field } from "@/components/ui";
import { getActions } from "@/lib/actions";
import { loadRepoPage } from "@/lib/repo-page";
export default async function ActionsSettings({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { owner, repo: name } = await params,
    { error } = await searchParams;
  const { actor, user, organization, repo } = await loadRepoPage(owner, name),
    actions = getActions();
  await actions.access(actor, owner, name, "admin");
  const settings = await actions.store.settings(repo.id),
    environments = await actions.store.environments(repo.id);
  const failures = await actions.store.failedEvents(repo.id);
  const secrets = await Promise.all(
    environments.map(async (e) => ({
      name: e.name,
      keys: (await actions.store.secretRows(repo.id, e.name)).map((s) => s.name),
    })),
  );
  return (
    <Shell organization={organization} user={user}>
      <RepoHeader current="Actions" owner={owner} repo={repo} />
      <div className="container page">
        <h1>Actions settings</h1>
        {error ? <Alert title="Change not saved">{error}</Alert> : null}
        {env.ACTIONS_ENABLED !== "true" ? (
          <Alert title="Installation paused" tone="info">
            The installation administrator must configure and enable the Actions Worker before runs
            can execute.
          </Alert>
        ) : null}
        <div className="settings-sections">
          {failures.length ? (
            <Box title="Event delivery failures">
              <ul>
                {failures.map((f) => (
                  <li key={f.id}>
                    {f.error} · {f.attempts} attempts
                  </li>
                ))}
              </ul>
              <form action={actionOperation}>
                <ActionFields owner={owner} repo={name} operation="retry-events" />
                <button className="btn">Retry pending events</button>
              </form>
            </Box>
          ) : null}
          <Box title="Execution and agent">
            <form action={actionOperation} className="form">
              <ActionFields owner={owner} repo={name} operation="configure" />
              <label>
                <input type="checkbox" name="enabled" defaultChecked={settings.enabled} /> Enable
                Actions for this repository
              </label>
              <div className="form-row">
                <Field label="On failure">
                  <select name="healing" defaultValue={settings.healing}>
                    <option value="off">Agent off</option>
                    <option value="diagnose">Diagnose the failure</option>
                    <option value="repair">Diagnose and propose a fix PR</option>
                  </select>
                </Field>
                <Field label="Concurrent jobs">
                  <input
                    type="number"
                    name="concurrency"
                    min={1}
                    max={4}
                    defaultValue={settings.concurrency}
                  />
                </Field>
                <Field label="Log and artifact retention (days)">
                  <input
                    type="number"
                    name="retentionDays"
                    min={1}
                    max={90}
                    defaultValue={settings.retentionDays}
                  />
                </Field>
              </div>
              <p className="field-hint">
                Saving authorizes repository-scoped checkout credentials under your account. The
                agent may read source and logs through Workers AI. Repair mode can create a branch
                and PR under your account; tests, workflows, and configuration are protected.
                Deployment workflows are excluded from healing.
              </p>
              <button className="btn btn-primary">Save settings</button>
            </form>
          </Box>
          <Box
            title="Environments"
            description="Deployment jobs only run at the current head of their allowed branch. Pull request runs never receive environment secrets."
          >
            {environments.map((e) => (
              <p key={e.name}>
                <strong>{e.name}</strong> · {e.branch} ·{" "}
                {e.requireApproval ? "Approval required" : "No approval required"} · secret names:{" "}
                {secrets.find((s) => s.name === e.name)?.keys.join(", ") || "none"}
              </p>
            ))}
            <form action={actionOperation} className="form">
              <ActionFields owner={owner} repo={name} operation="environment" />
              <div className="form-row">
                <Field label="Name">
                  <input name="name" placeholder="production" required />
                </Field>
                <Field label="Allowed branch">
                  <input name="branch" defaultValue={repo.defaultBranch} required />
                </Field>
              </div>
              <label>
                <input type="checkbox" name="requireApproval" defaultChecked /> Require
                administrator approval for every deployment
              </label>
              <button className="btn">Create or update environment</button>
            </form>
          </Box>
          {environments.length ? (
            <Box
              title="Environment secrets"
              description="Values are encrypted at rest and cannot be read back. Changing an environment invalidates pending approvals."
            >
              <form action={actionOperation} className="form">
                <ActionFields owner={owner} repo={name} operation="secret" />
                <div className="form-row">
                  <Field label="Environment">
                    <select name="environment">
                      {environments.map((e) => (
                        <option key={e.name}>{e.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Secret name">
                    <input name="name" placeholder="DEPLOY_TOKEN" required />
                  </Field>
                </div>
                <Field label="Value">
                  <input type="password" name="value" autoComplete="new-password" />
                </Field>
                <label>
                  <input type="checkbox" name="remove" /> Delete this secret
                </label>
                <button className="btn">Save secret</button>
              </form>
            </Box>
          ) : null}
          <Box title="Workflow example">
            <pre
              style={{ whiteSpace: "pre-wrap" }}
            >{`# .forgit/workflows/ci.yml\nname: CI\non: [push, pull_request, workflow_dispatch]\njobs:\n  test:\n    runs-on: node-26\n    timeout-minutes: 15\n    steps:\n      - name: Install\n        run: pnpm install --frozen-lockfile\n      - name: Test\n        run: pnpm test`}</pre>
            <p>
              Checkout is automatic at the exact commit. Required checks use names such as{" "}
              <code>actions/ci.yml/pull_request</code>. Jobs support <code>needs</code>,{" "}
              <code>env</code>, <code>environment</code>, and explicit artifact file paths.
              Marketplace actions and GitHub expression syntax are not supported.
            </p>
          </Box>
        </div>
      </div>
    </Shell>
  );
}
