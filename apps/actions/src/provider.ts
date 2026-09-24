import {
  SourceControlProvider,
  type SourceControlAdapter,
  type SourceControlProviderDefinition,
  type SourceControlSource,
  type SourceControlCheckout,
} from "@cloudflare/ci/worker/source-control";
import type { Bindings } from "./env.ts";
import { ForgitRunner } from "./runner.ts";

export type ForgitProvider = SourceControlProviderDefinition<
  "forgit",
  { type: "push" | "pull_request" | "workflow_dispatch" },
  { runId: string }
>;
class ForgitSource extends SourceControlProvider<ForgitProvider> {
  constructor(private readonly env: Bindings) {
    super();
  }
  async receiveEvent() {
    return null;
  }
  async getSourceCheckout(source: SourceControlSource): Promise<SourceControlCheckout> {
    // The runner exchanges the run/job identity for a short-lived read token.
    return {
      kind: "git",
      remote: `${this.env.FORGIT_ORIGIN}/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}.git`,
      sha: source.sha,
      token: "",
    };
  }
  async listTreeBlobs() {
    return null;
  }
  async getStepCredentialEnv() {
    return {};
  }
}
export const forgitProvider: SourceControlAdapter<ForgitProvider> = {
  id: "forgit",
  repository: {},
  accepts: (source) => source.provider === "forgit",
  assertSource(source) {
    if (source.provider !== "forgit") throw new Error("Unsupported source provider");
  },
  create: (env) => new ForgitSource(env as Bindings),
  createRunner: (env, input) => new ForgitRunner(env as Bindings, input.instanceId, input.label),
};
