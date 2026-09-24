/* oxlint-disable no-control-regex -- Reject control characters at untrusted path boundaries. */
import { parseDocument } from "yaml";
import { ForgeError } from "@forgit/domain";
import type { Job, Trigger, Workflow } from "./types.ts";

const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const ENV = /^[A-Z_][A-Z0-9_]{0,63}$/;
const RESERVED_ENV = /^(FORGIT_|SOURCE_CONTROL_|BASH_ENV$|ENV$|NODE_OPTIONS$|LD_|PATH$|HOME$)/;
export function invalid(message: string): never {
  throw new ForgeError(message, 422, "workflow");
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], label: string) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) invalid(`${label}: unsupported key ${key}`);
}
function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
    invalid(`${label} must be a nonempty string of at most ${max} characters`);
  return value;
}
function strings(value: unknown, label: string, max = 20): string[] {
  const values = typeof value === "string" ? [value] : value;
  if (!Array.isArray(values) || values.length > max)
    invalid(`${label} must be a list of at most ${max} strings`);
  return values.map((v) => text(v, label));
}
function env(value: unknown, label: string): Record<string, string> {
  const values = value === undefined ? {} : object(value, label);
  if (Object.keys(values).length > 32) invalid(`${label} has too many variables`);
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      if (!ENV.test(key) || RESERVED_ENV.test(key))
        invalid(`${label}: reserved or invalid variable ${key}`);
      if (typeof value !== "string" || value.length > 4096 || value.includes("\0"))
        invalid(`${label}.${key} must be a string of at most 4096 characters`);
      validateReferences(value);
      return [key, value];
    }),
  );
}
export function relativePath(value: string): string {
  if (
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((v) => v === ".." || v === ".git") ||
    /[\x00-\x1f]/.test(value)
  )
    invalid("Path must remain inside the repository and outside .git");
  return value;
}
function validateReferences(value: string) {
  const stripped = value.replace(
    /\$\{\{\s*(?:secrets\.[A-Z_][A-Z0-9_]*|forgit\.(?:sha|ref|repository|run_id))\s*\}\}/g,
    "",
  );
  if (stripped.includes("${{"))
    invalid(
      "Only secrets.NAME and forgit.sha/ref/repository/run_id references are supported in env",
    );
}
export function resolveEnv(
  values: Record<string, string>,
  context: { sha: string; ref: string; repository: string; run_id: string },
  secrets: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value.replace(
        /\$\{\{\s*(secrets|forgit)\.([A-Za-z_]+)\s*\}\}/g,
        (_all, type: string, name: string) => {
          const resolved =
            type === "secrets" ? secrets[name] : context[name as keyof typeof context];
          if (resolved === undefined) invalid(`Unavailable ${type} reference: ${name}`);
          return resolved;
        },
      ),
    ]),
  );
}
export function parseWorkflow(source: string): Workflow {
  if (new TextEncoder().encode(source).length > 64 * 1024) invalid("Workflow exceeds 64 KiB");
  const doc = parseDocument(source, { uniqueKeys: true, version: "1.2" });
  if (doc.errors.length) invalid(doc.errors.map((e) => e.message).join("\n"));
  let value: unknown;
  try {
    value = doc.toJS({ maxAliasCount: 0 });
  } catch {
    invalid("YAML aliases are not supported");
  }
  const root = object(value, "workflow");
  keys(root, ["version", "name", "on", "jobs", "env"], "workflow");
  if (root.version !== undefined && root.version !== 1)
    invalid("Only workflow version 1 is supported");
  const globalEnv = env(root.env, "env");
  const on: Workflow["on"] = {};
  const events =
    typeof root.on === "string" || Array.isArray(root.on)
      ? Object.fromEntries(strings(root.on, "on").map((name) => [name, {}]))
      : object(root.on, "on");
  keys(events, ["push", "pull_request", "workflow_dispatch"], "on");
  if (!Object.keys(events).length) invalid("At least one trigger is required");
  for (const [name, value] of Object.entries(events)) {
    const filters = value === null ? {} : object(value, `on.${name}`);
    keys(
      filters,
      name === "push" ? ["branches", "tags"] : name === "pull_request" ? ["branches"] : [],
      `on.${name}`,
    );
    on[name as Trigger] = Object.fromEntries(
      Object.entries(filters).map(([k, v]) => [
        k,
        strings(v, k).map((pattern) => {
          if (pattern.startsWith("!")) invalid("Negative branch patterns are not supported");
          return pattern;
        }),
      ]),
    );
  }
  const jobs = object(root.jobs, "jobs");
  if (!Object.keys(jobs).length || Object.keys(jobs).length > 12)
    invalid("Define between 1 and 12 jobs");
  const parsed: Job[] = Object.entries(jobs).map(([id, value]) => {
    if (!ID.test(id)) invalid(`Invalid job id: ${id}`);
    const job = object(value, `jobs.${id}`);
    keys(
      job,
      ["name", "runs-on", "needs", "timeout-minutes", "steps", "env", "environment", "artifacts"],
      `jobs.${id}`,
    );
    if (job["runs-on"] !== "node-26") invalid(`jobs.${id}: runs-on must be node-26`);
    const timeout = job["timeout-minutes"] ?? 15;
    if (!Number.isInteger(timeout) || Number(timeout) < 1 || Number(timeout) > 60)
      invalid("timeout-minutes must be between 1 and 60");
    if (!Array.isArray(job.steps) || !job.steps.length || job.steps.length > 30)
      invalid(`jobs.${id}: define between 1 and 30 steps`);
    const jobEnv = { ...globalEnv, ...env(job.env, `jobs.${id}.env`) };
    const steps = job.steps.map((value, i) => {
      const step = object(value, `${id}.steps[${i}]`);
      keys(step, ["id", "name", "run", "working-directory", "env"], `${id}.steps[${i}]`);
      const stepId = step.id === undefined ? `step-${i + 1}` : text(step.id, "step id");
      if (!ID.test(stepId)) invalid(`Invalid step id: ${stepId}`);
      const run = text(step.run, "run", 16000);
      if (run.includes("${{"))
        invalid("Use env references instead of interpolating expressions into shell commands");
      return {
        id: stepId,
        name: step.name === undefined ? stepId : text(step.name, "step name"),
        run,
        cwd: relativePath(String(step["working-directory"] ?? ".")),
        env: env(step.env, "step env"),
      };
    });
    if (new Set(steps.map((s) => s.id)).size !== steps.length)
      invalid(`Duplicate step ids in ${id}`);
    const environment =
      job.environment === undefined ? undefined : text(job.environment, "environment", 64);
    if (environment && !ID.test(environment)) invalid("Invalid environment name");
    if (!environment && JSON.stringify([jobEnv, ...steps.map((s) => s.env)]).includes("secrets."))
      invalid("Secrets require an explicit environment");
    return {
      id,
      name: job.name === undefined ? id : text(job.name, "job name"),
      runner: "node-26",
      timeoutMinutes: Number(timeout),
      needs: job.needs === undefined ? [] : strings(job.needs, "needs", 12),
      env: jobEnv,
      steps,
      environment,
      artifacts:
        job.artifacts === undefined
          ? []
          : strings(job.artifacts, "artifacts", 10).map(relativePath),
    };
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) invalid("Job dependencies contain a cycle");
    if (visited.has(id)) return;
    const job = parsed.find((j) => j.id === id);
    if (!job) invalid(`Unknown dependency: ${id}`);
    visiting.add(id);
    job.needs.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  }
  parsed.forEach((job) => visit(job.id));
  return {
    version: 1,
    name: root.name === undefined ? "Workflow" : text(root.name, "name"),
    on,
    jobs: parsed,
  };
}
export function matchesPattern(value: string, pattern: string): boolean {
  if (pattern.startsWith("!")) invalid("Negative branch patterns are not supported");
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", ".*");
  return new RegExp(`^${escaped}$`).test(value);
}
export function matchesWorkflow(workflow: Workflow, trigger: Trigger, ref: string): boolean {
  const filter = workflow.on[trigger];
  if (!filter) return false;
  if (trigger === "workflow_dispatch") return true;
  const tag = ref.startsWith("refs/tags/");
  const patterns = tag ? filter.tags : filter.branches;
  if (!patterns) return !(tag ? filter.branches : filter.tags);
  return patterns.some((pattern) =>
    matchesPattern(ref.replace(/^refs\/(heads|tags)\//, ""), pattern),
  );
}
export async function digest(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
