import { headers } from "next/headers";
import { notFound } from "next/navigation";

import {
  archiveAction,
  deleteRepositoryAction,
  deleteWebhookAction,
  memberAction,
  rulesAction,
} from "@/app/actions";
import { WebhookForm } from "@/components/webhook-form";
import { RepoNav, Shell } from "@/components/shell";
import { requireOrganization } from "@/lib/session";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { owner, repo: name } = await params;
  const { error } = await searchParams;
  const { services, actor, user } = await requireOrganization();
  const loaded = await services.requireRepo(actor, owner, name, "read").catch(() => null);
  if (!loaded) notFound();
  const rules = await services.store.getRules(loaded.repo.id);
  const members = await services.store.listRepoMembers(loaded.repo.id);
  const hooks = await services.store.listWebhooks(loaded.repo.id);
  const audit = await services.store.listAudit(loaded.repo.id, 15);
  const host = (await headers()).get("host") ?? owner;
  const admin = loaded.actual === "admin";
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>Settings</h1>
        <p className="muted">Backing store {loaded.repo.backingId} is immutable.</p>
      </div>
      <RepoNav owner={owner} name={name} current="Settings" />
      {error ? <p className="error">{error}</p> : null}
      <div className="pad">
        <h2>Access</h2>
        {members.map((member) => (
          <p key={member.userId}>
            {member.login} · {member.role}
          </p>
        ))}
      </div>
      {admin ? (
        <form action={memberAction} className="stack">
          <input type="hidden" name="owner" value={owner} />
          <input type="hidden" name="repo" value={name} />
          <label>
            Login
            <input name="login" required />
          </label>
          <label>
            Role
            <select name="role">
              <option value="read">Read</option>
              <option value="write">Write</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit">Save access</button>
        </form>
      ) : null}
      {admin ? (
        <form action={rulesAction} className="stack">
          <h2>Protection</h2>
          <input type="hidden" name="owner" value={owner} />
          <input type="hidden" name="repo" value={name} />
          <label>
            Required approvals
            <input name="approvals" type="number" min="0" defaultValue={rules.requiredApprovals} />
          </label>
          <label>
            Required check names
            <input name="checks" defaultValue={rules.requiredChecks.join(", ")} />
          </label>
          <p className="muted">
            The default branch rejects direct updates in walgit. Squash merge is the bypass.
          </p>
          <button type="submit">Save protection</button>
        </form>
      ) : null}
      <div className="pad">
        <h2>Webhooks</h2>
        {hooks.length === 0 ? <p className="muted">None configured.</p> : null}
        {hooks.map((hook) => (
          <form action={deleteWebhookAction} className="row" key={hook.id}>
            <input type="hidden" name="owner" value={owner} />
            <input type="hidden" name="repo" value={name} />
            <input type="hidden" name="id" value={hook.id} />
            <span>
              {hook.url} · {hook.events.join(", ")}
            </span>
            {admin ? (
              <button className="quiet" type="submit">
                Delete
              </button>
            ) : null}
          </form>
        ))}
      </div>
      {admin ? <WebhookForm owner={owner} repo={name} /> : null}
      <div className="pad">
        <h2>Audit</h2>
        {audit.map((event) => (
          <p key={event.id}>
            <span className="sha">{event.action}</span> {event.target}
          </p>
        ))}
      </div>
      {admin && !loaded.repo.archived ? (
        <form action={archiveAction} className="stack">
          <input type="hidden" name="owner" value={owner} />
          <input type="hidden" name="repo" value={name} />
          <button className="quiet" type="submit">
            Archive repository
          </button>
        </form>
      ) : null}
      {admin ? (
        <form action={deleteRepositoryAction} className="stack">
          <h2>Delete</h2>
          <input type="hidden" name="owner" value={owner} />
          <input type="hidden" name="repo" value={name} />
          <label>
            Type {name} to delete the repository and its Git data
            <input name="confirm" autoComplete="off" />
          </label>
          <button className="quiet" type="submit">
            Delete repository
          </button>
        </form>
      ) : null}
    </Shell>
  );
}
