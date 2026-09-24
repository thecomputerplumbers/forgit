declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ACTIONS_ENABLED?: string;
    ACTIONS_INTERNAL_TOKEN?: string;
    ACTIONS_EVENT_SECRET?: string;
    ACTIONS_ENCRYPTION_KEY?: string;
    ACTIONS_QUEUE?: Queue<{ runId: string }>;
    ACTIONS_WORKER?: Fetcher;
    ACTIONS_BUCKET?: R2Bucket;
    GIT_CONTAINER: DurableObjectNamespace;
    ASSETS: Fetcher;
    EMAIL: SendEmail;
    APP_URL: string;
    DISABLE_SIGN_UP?: string;
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
