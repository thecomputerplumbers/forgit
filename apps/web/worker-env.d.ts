declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    GIT_CONTAINER: DurableObjectNamespace;
    ASSETS: Fetcher;
    APP_URL: string;
    BETTER_AUTH_SECRET?: string;
    WALGIT_TOKEN_FORGIT: string;
    MERGE_INTERNAL_TOKEN: string;
    WALGIT_URL?: string;
  }
}
