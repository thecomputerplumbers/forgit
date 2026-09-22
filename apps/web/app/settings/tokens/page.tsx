import { headers } from "next/headers";

import { revokeTokenAction } from "@/app/actions";
import { Shell } from "@/components/shell";
import { TokenForm } from "@/components/token-form";
import { requireForge } from "@/lib/session";

export default async function TokensPage() {
  const { services, user } = await requireForge();
  const tokens = await services.store.listTokens(user.id);
  const host = (await headers()).get("host") ?? "forgit";
  return (
    <Shell host={host} login={user.login}>
      <div className="sheet-head">
        <h1>Tokens</h1>
        <p className="muted">
          Use a personal token as the Git password, or as GH_ENTERPRISE_TOKEN. Machine tokens should
          expire with the job.
        </p>
      </div>
      {tokens.map((token) => (
        <form action={revokeTokenAction} className="row" key={token.id}>
          <strong>{token.name}</strong>
          <span className="sha">
            {token.prefix}… · {token.kind}
            {token.revokedAt ? " · revoked" : ""}
          </span>
          <input type="hidden" name="id" value={token.id} />
          {token.revokedAt ? (
            <span />
          ) : (
            <button className="quiet" type="submit">
              Revoke
            </button>
          )}
        </form>
      ))}
      <TokenForm />
    </Shell>
  );
}
