import type { Sql } from "@forgit/db/sql-store";
import { ForgeError } from "@forgit/domain";
import {
  ActionRunSchema,
  ActionSettingsSchema,
  DEFAULT_SETTINGS,
  workflowCheck,
  type ActionRun,
  type ActionSettings,
  type Environment,
} from "./types.ts";

type Row = { document: string; version: number; sequence: number };
function decode(row: Row): ActionRun {
  return {
    ...ActionRunSchema.parse(JSON.parse(row.document)),
    version: row.version,
    ordinal: row.sequence,
  };
}
export class ActionsStore {
  constructor(
    readonly sql: Sql,
    readonly now = () => Date.now(),
  ) {}
  async settings(repo: string): Promise<ActionSettings> {
    const [row] = await this.sql.all<{ document: string }>(
      "SELECT document FROM action_settings WHERE repository_id=?",
      [repo],
    );
    return row ? ActionSettingsSchema.parse(JSON.parse(row.document)) : { ...DEFAULT_SETTINGS };
  }
  async setSettings(repo: string, settings: ActionSettings) {
    await this.sql.run(
      "INSERT INTO action_settings(repository_id,document) VALUES(?,?) ON CONFLICT(repository_id) DO UPDATE SET document=excluded.document",
      [repo, JSON.stringify(settings)],
    );
  }
  async receive(id: string, repo: string, document: unknown) {
    return (
      (
        await this.sql.run(
          "INSERT OR IGNORE INTO action_events(id,repository_id,document,created_at) VALUES(?,?,?,?)",
          [id, repo, JSON.stringify(document), this.now()],
        )
      ).changes > 0
    );
  }
  async pendingEvents() {
    return this.sql.all<{ id: string; repository_id: string; document: string; attempts: number }>(
      "SELECT * FROM action_events WHERE processed_at IS NULL AND attempts<20 ORDER BY created_at LIMIT 20",
    );
  }
  async failedEvents(repo: string) {
    return this.sql.all<{ id: string; error: string; attempts: number }>(
      "SELECT id,error,attempts FROM action_events WHERE repository_id=? AND processed_at IS NULL AND error IS NOT NULL ORDER BY created_at LIMIT 20",
      [repo],
    );
  }
  async retryEvents(repo: string) {
    await this.sql.run(
      "UPDATE action_events SET attempts=0,error=NULL WHERE repository_id=? AND processed_at IS NULL",
      [repo],
    );
  }
  async processed(id: string) {
    await this.sql.run("UPDATE action_events SET processed_at=?,error=NULL WHERE id=?", [
      this.now(),
      id,
    ]);
  }
  async eventError(id: string, error: string) {
    await this.sql.run("UPDATE action_events SET attempts=attempts+1,error=? WHERE id=?", [
      error.slice(0, 1000),
      id,
    ]);
  }
  async create(run: ActionRun): Promise<ActionRun> {
    await this.sql.run(
      "INSERT OR IGNORE INTO action_runs(id,repository_id,event_key,workflow_path,head_sha,check_name,document) VALUES(?,?,?,?,?,?,?)",
      [
        run.id,
        run.repositoryId,
        run.eventKey,
        run.workflowPath,
        run.sha,
        workflowCheck(run.workflowPath, run.trigger),
        JSON.stringify(run),
      ],
    );
    const [row] = await this.sql.all<Row>(
      "SELECT * FROM action_runs WHERE repository_id=? AND event_key=? AND workflow_path=?",
      [run.repositoryId, run.eventKey, run.workflowPath],
    );
    if (!row) throw new Error("Run was not persisted");
    return decode(row);
  }
  async get(id: string): Promise<ActionRun | null> {
    const [row] = await this.sql.all<Row>("SELECT * FROM action_runs WHERE id=?", [id]);
    return row ? decode(row) : null;
  }
  async list(repo: string, before = Number.MAX_SAFE_INTEGER, limit = 30): Promise<ActionRun[]> {
    return (
      await this.sql.all<Row>(
        "SELECT * FROM action_runs WHERE repository_id=? AND sequence<? ORDER BY sequence DESC LIMIT ?",
        [repo, before, Math.min(100, Math.max(1, limit))],
      )
    ).map(decode);
  }
  async active(): Promise<ActionRun[]> {
    return (
      await this.sql.all<Row>(
        "SELECT * FROM action_runs WHERE json_extract(document,'$.status')!='completed' OR json_extract(document,'$.healing.status') IN ('pending','running') ORDER BY sequence LIMIT 100",
      )
    ).map(decode);
  }
  async update(id: string, change: (run: ActionRun) => boolean | void): Promise<ActionRun> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const run = await this.get(id);
      if (!run) throw new ForgeError("Run not found", 404, "not_found");
      const version = run.version!;
      if (change(run) === false) return run;
      run.updatedAt = this.now();
      delete run.version;
      delete run.ordinal;
      const result = await this.sql.run(
        "UPDATE action_runs SET document=?,version=version+1 WHERE id=? AND version=?",
        [JSON.stringify(run), id, version],
      );
      if (result.changes) return { ...run, version: version + 1 };
    }
    throw new ForgeError("Run changed concurrently; retry", 409, "conflict");
  }
  async environments(repo: string): Promise<Environment[]> {
    return (
      await this.sql.all<{ document: string; version: number }>(
        "SELECT document,version FROM action_environments WHERE repository_id=? ORDER BY name",
        [repo],
      )
    ).map((r) => ({ ...JSON.parse(r.document), version: r.version }));
  }
  async environment(repo: string, name: string) {
    return (await this.environments(repo)).find((e) => e.name === name) ?? null;
  }
  async setEnvironment(repo: string, value: Omit<Environment, "version">) {
    await this.sql.run(
      "INSERT INTO action_environments(repository_id,name,document) VALUES(?,?,?) ON CONFLICT(repository_id,name) DO UPDATE SET document=excluded.document,version=action_environments.version+1",
      [repo, value.name, JSON.stringify(value)],
    );
  }
  async secretRows(repo: string, environment: string) {
    return this.sql.all<{ name: string; encrypted: string; updated_at: number }>(
      "SELECT name,encrypted,updated_at FROM action_secrets WHERE repository_id=? AND environment=?",
      [repo, environment],
    );
  }
  async setSecret(repo: string, environment: string, name: string, encrypted: string) {
    await this.sql.run(
      "INSERT INTO action_secrets(repository_id,environment,name,encrypted,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(repository_id,environment,name) DO UPDATE SET encrypted=excluded.encrypted,updated_at=excluded.updated_at",
      [repo, environment, name, encrypted, this.now()],
    );
  }
  async deleteSecret(repo: string, environment: string, name: string) {
    await this.sql.run(
      "DELETE FROM action_secrets WHERE repository_id=? AND environment=? AND name=?",
      [repo, environment, name],
    );
  }
  async acquire(run: ActionRun, jobId: string, concurrency: number, environment?: string) {
    const id = `${run.id}:${jobId}`;
    await this.sql.run("DELETE FROM action_leases WHERE expires_at<?", [this.now()]);
    // SQLite serializes this single write. Both limits are checked at admission.
    await this.sql.run(
      `INSERT OR IGNORE INTO action_leases(id,repository_id,run_id,job_id,environment,expires_at)
      SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM action_leases)<4 AND (SELECT count(*) FROM action_leases WHERE repository_id=?)<?`,
      [
        id,
        run.repositoryId,
        run.id,
        jobId,
        environment ?? null,
        this.now() + 75 * 60000,
        run.repositoryId,
        concurrency,
      ],
    );
    return (await this.sql.all("SELECT id FROM action_leases WHERE id=?", [id])).length > 0;
  }
  async release(run: string, job: string) {
    await this.sql.run("DELETE FROM action_leases WHERE id=?", [`${run}:${job}`]);
  }
  async beginDeployment(run: ActionRun, job: string, environment: string): Promise<string> {
    const id = `${run.id}:${job}`;
    await this.sql.run(
      "INSERT OR IGNORE INTO action_deployments(id,repository_id,run_id,job_id,environment,head_sha,state,created_at) VALUES(?,?,?,?,?,?,'running',?)",
      [id, run.repositoryId, run.id, job, environment, run.sha, this.now()],
    );
    return id;
  }
  async finishDeployment(id: string, state: string) {
    await this.sql.run(
      "UPDATE action_deployments SET state=?,completed_at=? WHERE id=? AND state='running'",
      [state, this.now(), id],
    );
  }
  async deployments(repo: string) {
    return this.sql.all(
      "SELECT * FROM action_deployments WHERE repository_id=? ORDER BY created_at DESC LIMIT 100",
      [repo],
    );
  }
}
