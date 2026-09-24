import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { boundedLogCommand } from "../apps/actions/src/process.ts";

test("bounded logs drain excess output, fail overflow, and preserve command failures", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgit-log-test-"));
  const log = join(directory, "step.log");
  try {
    const overflow = spawnSync("bash", [
      "-c",
      boundedLogCommand("node -e 'process.stdout.write(Buffer.alloc(65536, 120))'", log, 1024),
    ]);
    assert.equal(overflow.status, 91);
    assert.equal(readFileSync(log).length, 1024);
    const failed = spawnSync("bash", [
      "-c",
      boundedLogCommand("bash -c 'echo failed >&2; exit 7'", log, 1024),
    ]);
    assert.equal(failed.status, 7);
    assert.equal(readFileSync(log, "utf8"), "failed\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
