export const SCOPES = [
  "user:read",
  "repo:read",
  "repo:write",
  "repo:admin",
  "pull_request:read",
  "pull_request:write",
  "review:write",
  "checks:read",
  "checks:write",
  "workflow:run",
  "webhook:admin",
] as const;

export type Scope = (typeof SCOPES)[number];

const SCOPE_SET = new Set<string>(SCOPES);

export function isScope(value: string): value is Scope {
  return SCOPE_SET.has(value);
}

export function parseScopes(values: readonly string[]): Scope[] {
  const scopes: Scope[] = [];
  for (const value of values) {
    if (!isScope(value)) throw new Error(`Unknown scope: ${value}`);
    if (!scopes.includes(value)) scopes.push(value);
  }
  return scopes;
}

export type RepoRole = "read" | "write" | "admin";

const ROLE_SCOPES: Record<RepoRole, readonly Scope[]> = {
  read: ["user:read", "repo:read", "pull_request:read", "checks:read"],
  write: [
    "user:read",
    "repo:read",
    "repo:write",
    "pull_request:read",
    "pull_request:write",
    "review:write",
    "checks:read",
  ],
  admin: SCOPES,
};

export function scopesForRole(role: RepoRole): Scope[] {
  return [...ROLE_SCOPES[role]];
}

export function hasScope(granted: readonly Scope[], required: Scope): boolean {
  if (granted.includes(required)) return true;
  if (
    required === "repo:read" &&
    (granted.includes("repo:write") || granted.includes("repo:admin"))
  )
    return true;
  if (required === "repo:write" && granted.includes("repo:admin")) return true;
  if (required === "pull_request:read" && granted.includes("pull_request:write")) return true;
  if (required === "checks:read" && granted.includes("checks:write")) return true;
  return false;
}

export function intersectScopes(left: readonly Scope[], right: readonly Scope[]): Scope[] {
  return left.filter((scope) => hasScope(right, scope));
}
