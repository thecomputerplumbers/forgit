declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    GIT_CONTAINER: DurableObjectNamespace;
    ASSETS: Fetcher;
    APP_URL: string;
    BETTER_AUTH_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    WALGIT_TOKEN_FORGIT: string;
    MERGE_INTERNAL_TOKEN: string;
    R2_ENDPOINT: string;
    R2_ACCESS_KEY_ID?: string;
    R2_SECRET_ACCESS_KEY?: string;
    WALGIT_URL?: string;
  }
}
