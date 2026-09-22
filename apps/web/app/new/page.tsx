import { headers } from "next/headers";

import { createRepositoryAction } from "@/app/actions";
import { Shell } from "@/components/shell";
import { requireOrganization } from "@/lib/session";

export default async function NewRepositoryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { user } = await requireOrganization();
  const { error } = await searchParams;
  const host = (await headers()).get("host") ?? "forgit";
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>New repository</h1>
        <p className="muted">
          The Git data is created in walgit. This page records who can see it.
        </p>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <form action={createRepositoryAction} className="stack">
        <label>
          Name
          <input name="name" required pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,99}" />
        </label>
        <label>
          Description
          <input name="description" />
        </label>
        <label>
          Visibility
          <select name="visibility">
            <option value="private">Private</option>
            <option value="public">Public read</option>
          </select>
        </label>
        <button type="submit">Create repository</button>
      </form>
    </Shell>
  );
}
