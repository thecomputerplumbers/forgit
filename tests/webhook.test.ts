import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertWebhookUrl, ForgeError } from "@forgit/domain";

describe("webhook urls", () => {
  it("accepts a public https endpoint and rejects local or credentialed targets", () => {
    assert.doesNotThrow(() => assertWebhookUrl("https://hooks.example.com/forgit"));
    for (const url of [
      "http://hooks.example.com/forgit",
      "https://user:pass@hooks.example.com/forgit",
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.1.2.3/hook",
      "https://192.168.1.8/hook",
      "https://169.254.169.254/latest",
      "https://metadata.google.internal/hook",
    ]) {
      assert.throws(
        () => assertWebhookUrl(url),
        (error: unknown) => error instanceof ForgeError && error.status === 422,
      );
    }
  });
});
