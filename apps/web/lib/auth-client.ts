import { organizationClient } from "better-auth/client/plugins";
import { ssoClient } from "@better-auth/sso/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [organizationClient(), ssoClient({ domainVerification: { enabled: true } })],
});
