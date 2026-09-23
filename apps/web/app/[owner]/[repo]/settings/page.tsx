import {
  archiveAction,
  deleteRepositoryAction,
  deleteWebhookAction,
  memberAction,
  rulesAction,
} from "@/app/actions";
import { Icon, type IconName } from "@/components/icons";
import { RepoHeader } from "@/components/repo";
import { Shell } from "@/components/shell";
import { WebhookForm } from "@/components/webhook-form";
import { Alert, Avatar, Badge, Box, EmptyState, Field, TimeAgo } from "@/components/ui";
import { loadLogins, loadRepoPage } from "@/lib/repo-page";

const SECTIONS: Array<[string, string, IconName]> = [
  ["access", "Access", "users"],
  ["protection", "Branch protection", "shield"],
  ["webhooks", "Webhooks", "webhook"],
  ["audit", "Audit log", "history"],
  ["danger", "Danger zone", "alert"],
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  return { title: `Settings · ${owner}/${repo}` };
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { owner, repo: name } = await params;
  const { error } = await searchParams;
  const { services, user, organization, repo, role } = await loadRepoPage(owner, name);
  const [rules, members, hooks, audit] = await Promise.all([
    services.store.getRules(repo.id),
    services.store.listRepoMembers(repo.id),
    services.store.listWebhooks(repo.id),
    services.store.listAudit(repo.id, 25),
  ]);
  const actors = await loadLogins(
    services.store,
    audit.flatMap((event) => (event.actorId ? [event.actorId] : [])),
  );
  const admin = role === "admin" && !repo.archived;
  const hidden = (
    <>
      <input name="owner" type="hidden" value={owner} />
      <input name="repo" type="hidden" value={name} />
    </>
  );
  return (
    <Shell organization={organization} user={user}>
      <RepoHeader current="Settings" owner={owner} repo={repo} />
      <div className="container page">
        <div className="layout-settings">
          <nav aria-label="Settings sections" className="settings-nav">
            {SECTIONS.map(([id, label, icon]) => (
              <a href={`#${id}`} key={id}>
                <Icon name={icon} /> {label}
              </a>
            ))}
          </nav>
          <div className="settings-sections">
            {error ? <Alert title="That change was not saved">{error}</Alert> : null}
            {role !== "admin" ? (
              <Alert title="Read-only" tone="info">
                You need admin access to change these settings.
              </Alert>
            ) : repo.archived ? (
              <Alert title="This repository is archived" tone="warning">
                Settings are read-only while it is archived.
              </Alert>
            ) : null}

            <Box
              description="Organization owners and admins can administer every repository. Everyone else needs a role here."
              flush
              id="access"
              title="Access"
            >
              {members.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th className="hide-sm">Email</th>
                        <th className="num">Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member) => (
                        <tr key={member.userId}>
                          <td>
                            <span className="row">
                              <Avatar name={member.login} size={24} />{" "}
                              <strong>{member.login}</strong>
                            </span>
                          </td>
                          <td className="hide-sm muted">{member.email}</td>
                          <td className="num">
                            <Badge tone={member.role === "admin" ? "accent" : "neutral"}>
                              {member.role[0]?.toUpperCase()}
                              {member.role.slice(1)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="box-body muted">No one has been added directly yet.</p>
              )}
              {admin ? (
                <form
                  action={memberAction}
                  className="form"
                  style={{ padding: 16, borderTop: "1px solid var(--border)" }}
                >
                  {hidden}
                  <div className="form-row" style={{ alignItems: "end" }}>
                    <Field label="Username">
                      <input
                        autoComplete="off"
                        name="login"
                        placeholder="octocat"
                        required
                        spellCheck={false}
                      />
                    </Field>
                    <Field label="Role">
                      <select defaultValue="write" name="role">
                        <option value="read">Read: clone and view</option>
                        <option value="write">Write: push and merge</option>
                        <option value="admin">Admin: manage settings</option>
                      </select>
                    </Field>
                    <div>
                      <button className="btn btn-primary" type="submit">
                        <Icon name="plus" /> Add or update
                      </button>
                    </div>
                  </div>
                </form>
              ) : null}
            </Box>

            <Box
              description={
                <>
                  Direct pushes to <code>{repo.defaultBranch}</code> are always rejected. Changes
                  land through squash-merged pull requests.
                </>
              }
              id="protection"
              title="Branch protection"
            >
              {admin ? (
                <form action={rulesAction} className="form">
                  {hidden}
                  <div className="form-row">
                    <Field
                      hint="Approvals from people other than the author."
                      label="Required approvals"
                    >
                      <input
                        defaultValue={rules.requiredApprovals}
                        min="0"
                        name="approvals"
                        type="number"
                      />
                    </Field>
                    <Field
                      hint="Comma-separated check run names that must succeed."
                      label="Required checks"
                    >
                      <input
                        defaultValue={rules.requiredChecks.join(", ")}
                        name="checks"
                        placeholder="ci, lint"
                        spellCheck={false}
                      />
                    </Field>
                  </div>
                  <p className="field-hint">
                    Approvals are dismissed when new commits are pushed to the pull request.
                  </p>
                  <div className="form-actions">
                    <button className="btn btn-primary" type="submit">
                      Save rules
                    </button>
                  </div>
                </form>
              ) : (
                <ul className="about-list" style={{ margin: 0 }}>
                  <li>
                    <Icon name="users" /> {rules.requiredApprovals} required approvals
                  </li>
                  <li>
                    <Icon name="checkCircle" /> Required checks:{" "}
                    {rules.requiredChecks.length ? rules.requiredChecks.join(", ") : "none"}
                  </li>
                </ul>
              )}
            </Box>

            <Box
              description="forgit POSTs a signed JSON payload to each URL when events happen in this repository."
              flush
              id="webhooks"
              title="Webhooks"
            >
              {hooks.length ? (
                <ul className="list">
                  {hooks.map((hook) => (
                    <li key={hook.id}>
                      <Icon className="icon muted" name="webhook" />
                      <div className="list-main">
                        <div className="list-title mono" style={{ fontWeight: 500 }}>
                          {hook.url}
                        </div>
                        <div className="list-meta">
                          {hook.events.includes("*") ? "All events" : hook.events.join(", ")}
                          <span className="dot" />
                          Added <TimeAgo value={hook.createdAt} />
                          {hook.active ? null : (
                            <>
                              <span className="dot" />
                              <Badge tone="warning">Inactive</Badge>
                            </>
                          )}
                        </div>
                      </div>
                      {admin ? (
                        <form action={deleteWebhookAction}>
                          {hidden}
                          <input name="id" type="hidden" value={hook.id} />
                          <button className="btn btn-sm btn-danger" type="submit">
                            <Icon name="trash" /> Delete
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon="webhook" title="No webhooks">
                  Notify CI or chat when code is pushed or pull requests change.
                </EmptyState>
              )}
              {admin ? (
                <div style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
                  <WebhookForm owner={owner} repo={name} />
                </div>
              ) : null}
            </Box>

            <Box
              description="The 25 most recent changes to this repository."
              flush
              id="audit"
              title="Audit log"
            >
              {audit.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Target</th>
                        <th className="hide-sm">Actor</th>
                        <th className="num">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.map((event) => (
                        <tr key={event.id}>
                          <td>
                            <span className="audit-action">{event.action}</span>
                          </td>
                          <td className="muted">{event.target}</td>
                          <td className="hide-sm">
                            {event.actorId ? (
                              actors.get(event.actorId)
                            ) : (
                              <span className="muted">system</span>
                            )}
                          </td>
                          <td className="num muted">
                            <TimeAgo value={event.createdAt} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="box-body muted">Nothing recorded yet.</p>
              )}
            </Box>

            <Box flush id="danger" title="Danger zone" tone="danger">
              <div className="danger-row">
                <div>
                  <strong>Archive this repository</strong>
                  <p>Make it read-only. Pushes, pull requests, and settings changes stop.</p>
                </div>
                {repo.archived ? (
                  <Badge icon="archive" tone="warning">
                    Archived
                  </Badge>
                ) : (
                  <form action={archiveAction}>
                    {hidden}
                    <button className="btn btn-danger" disabled={role !== "admin"} type="submit">
                      <Icon name="archive" /> Archive
                    </button>
                  </form>
                )}
              </div>
              <div className="danger-row">
                <div>
                  <strong>Delete this repository</strong>
                  <p>
                    Permanently removes the repository and its Git data. Type <code>{name}</code> to
                    confirm.
                  </p>
                  <p className="muted" style={{ marginTop: 4 }}>
                    Backing store <code>{repo.backingId}</code>
                  </p>
                </div>
                <form action={deleteRepositoryAction} className="danger-confirm">
                  {hidden}
                  <input
                    aria-label={`Type ${name} to confirm`}
                    autoComplete="off"
                    disabled={role !== "admin"}
                    name="confirm"
                    pattern={name.replace(/[.]/g, "\\.")}
                    placeholder={name}
                    required
                    spellCheck={false}
                  />
                  <button className="btn btn-danger" disabled={role !== "admin"} type="submit">
                    <Icon name="trash" /> Delete
                  </button>
                </form>
              </div>
            </Box>
          </div>
        </div>
      </div>
    </Shell>
  );
}
