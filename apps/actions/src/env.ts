import type { CiBindings } from "@cloudflare/ci/worker";

export type Bindings = CiBindings & {
  FORGIT: Fetcher;
  FORGIT_ORIGIN: string;
  ACTIONS_INTERNAL_TOKEN: string;
  AI?: Ai;
  ACTIONS_LOCAL?: string;
  HEALING_MODEL?: string;
};
