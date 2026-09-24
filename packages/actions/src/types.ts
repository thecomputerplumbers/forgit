/* oxlint-disable no-control-regex -- Reject control characters at untrusted path boundaries. */
import * as z from "zod/mini";

export const TriggerSchema = z.enum(["push", "pull_request", "workflow_dispatch"]);
export const ConclusionSchema = z.enum([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
  "infrastructure_error",
]);
export const StatusSchema = z.enum(["queued", "in_progress", "waiting", "completed"]);
const Text = z.string();
const Timestamp = z.number().check(z.int(), z.minimum(0));
const Env = z.record(Text, Text);
export const StepSchema = z.strictObject({ id: Text, name: Text, run: Text, cwd: Text, env: Env });
export const JobSchema = z.strictObject({
  id: Text,
  name: Text,
  needs: z.array(Text),
  runner: z.literal("node-26"),
  timeoutMinutes: z.number().check(z.int(), z.minimum(1), z.maximum(60)),
  steps: z.array(StepSchema),
  env: Env,
  environment: z.optional(Text),
  artifacts: z.array(Text),
});
const Filter = z.strictObject({
  branches: z.optional(z.array(Text)),
  tags: z.optional(z.array(Text)),
});
export const WorkflowSchema = z.compile(
  z.strictObject({
    version: z.literal(1),
    name: Text,
    on: z.strictObject({
      push: z.optional(Filter),
      pull_request: z.optional(Filter),
      workflow_dispatch: z.optional(Filter),
    }),
    jobs: z.array(JobSchema),
  }),
);
export const StepResultSchema = z.strictObject({
  id: Text,
  name: Text,
  command: Text,
  status: StatusSchema,
  conclusion: z.nullable(ConclusionSchema),
  exitCode: z.optional(z.number().check(z.int())),
  startedAt: z.optional(Timestamp),
  completedAt: z.optional(Timestamp),
  logKey: z.optional(Text),
  logBytes: z.optional(Timestamp),
  logTruncated: z.optional(z.boolean()),
});
export const JobResultSchema = z.strictObject({
  id: Text,
  status: StatusSchema,
  conclusion: z.nullable(ConclusionSchema),
  steps: z.array(StepResultSchema),
  sandboxId: z.optional(Text),
  startedAt: z.optional(Timestamp),
  completedAt: z.optional(Timestamp),
  error: z.optional(Text),
  approvedBy: z.optional(Text),
  environmentVersion: z.optional(Timestamp),
  deploymentId: z.optional(Text),
});
export const ArtifactSchema = z.strictObject({
  name: Text,
  key: Text,
  bytes: Timestamp,
  digest: Text,
  jobId: Text,
});
export const HealingSchema = z.strictObject({
  status: z.enum(["pending", "running", "diagnosed", "proposed", "failed", "skipped"]),
  sandboxIds: z.optional(z.array(Text)),
  mode: z.enum(["diagnose", "repair"]),
  summary: z.optional(Text),
  branch: z.optional(Text),
  commit: z.optional(Text),
  pullNumber: z.optional(Timestamp),
  model: z.optional(Text),
  startedAt: z.optional(Timestamp),
  completedAt: z.optional(Timestamp),
  error: z.optional(Text),
});
export const ActionRunSchema = z.compile(
  z.strictObject({
    id: Text,
    rootId: Text,
    attempt: z.number().check(z.int(), z.minimum(1)),
    repositoryId: Text,
    owner: Text,
    repo: Text,
    workflowPath: Text,
    workflow: WorkflowSchema,
    planDigest: Text,
    sha: z.string().check(z.regex(/^[0-9a-f]{40}$/)),
    ref: Text,
    trigger: TriggerSchema,
    actorId: Text,
    eventKey: Text,
    status: StatusSchema,
    conclusion: z.nullable(ConclusionSchema),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    outputExpiredAt: z.optional(Timestamp),
    completedAt: z.optional(Timestamp),
    jobs: z.array(JobResultSchema),
    artifacts: z.array(ArtifactSchema),
    healing: z.optional(HealingSchema),
    error: z.optional(Text),
    cancelRequested: z.optional(z.boolean()),
    credentialIds: z.optional(z.array(Text)),
    credentialOwners: z.optional(z.record(Text, Text)),
    version: z.optional(Timestamp),
    ordinal: z.optional(Timestamp),
  }),
);
export const ActionSettingsSchema = z.compile(
  z.strictObject({
    enabled: z.boolean(),
    credentialUserId: z.nullable(Text),
    healing: z.enum(["off", "diagnose", "repair"]),
    concurrency: z.number().check(z.int(), z.minimum(1), z.maximum(4)),
    retentionDays: z.number().check(z.int(), z.minimum(1), z.maximum(90)),
  }),
);
export const EnvironmentSchema = z.compile(
  z.strictObject({
    name: z.string().check(z.regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)),
    branch: z.string().check(z.minLength(1), z.maxLength(200)),
    requireApproval: z.boolean(),
    version: z.number().check(z.int(), z.minimum(1)),
  }),
);
export const RefEventSchema = z.object({
  repo: z
    .string()
    .check(z.regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/)),
  action: z.enum(["create", "update", "delete"]),
  ref_type: z.enum(["branch", "tag", ""]),
  ref_name: z.string().check(z.minLength(6), z.maxLength(250), z.regex(/^refs\/[^\x00-\x20]+$/)),
  old: z.string().check(z.regex(/^[0-9a-f]{40}$/)),
  new: z.string().check(z.regex(/^[0-9a-f]{40}$/)),
  pusher: Text,
  _walgit: z.object({ schema_version: z.literal(1), seq: z.string().check(z.regex(/^\d{1,20}$/)) }),
});
export const RefEventsSchema = z.compile(z.array(RefEventSchema).check(z.maxLength(1000)));
export type Trigger = z.infer<typeof TriggerSchema>;
export type Conclusion = z.infer<typeof ConclusionSchema>;
export type Status = z.infer<typeof StatusSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Job = z.infer<typeof JobSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type StepResult = z.infer<typeof StepResultSchema>;
export type JobResult = z.infer<typeof JobResultSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type Healing = z.infer<typeof HealingSchema>;
export type ActionRun = z.infer<typeof ActionRunSchema>;
export type ActionSettings = z.infer<typeof ActionSettingsSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;
export type RefEvent = z.infer<typeof RefEventSchema>;
export const DEFAULT_SETTINGS: ActionSettings = {
  enabled: false,
  credentialUserId: null,
  healing: "off",
  concurrency: 2,
  retentionDays: 14,
};
export const workflowCheck = (path: string, trigger: Trigger) =>
  `actions/${path.replace(/^\.forgit\/workflows\//, "")}/${trigger}`;
export const initialJobs = (workflow: Workflow): JobResult[] =>
  workflow.jobs.map((job) => ({
    id: job.id,
    status: "queued",
    conclusion: null,
    steps: job.steps.map((step) => ({
      id: step.id,
      name: step.name,
      command: step.run,
      status: "queued",
      conclusion: null,
    })),
  }));
