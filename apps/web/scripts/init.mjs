import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { hashPassword } from "better-auth/crypto";

const usage = `Usage: pnpm --filter web run init --remote [--env cloud] --email owner@example.com --name "Owner Name" --organization "Company Name" --slug company

Use --local for a local D1 database (optionally with --persist-to DIR). The command prompts for the owner's password.
Run once, after D1 migrations and before inviting members.`;

function optionsFromArgs(args) {
  if (args.includes("--help")) {
    console.log(usage);
    process.exit(0);
  }
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (key === "--remote" || key === "--local") {
      options[key.slice(2)] = true;
    } else if (
      ["--email", "--name", "--organization", "--slug", "--persist-to", "--env"].includes(key) &&
      args[i + 1]
    ) {
      options[key.slice(2)] = args[++i];
    } else throw new Error(usage);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.email ?? ""))
    throw new Error("A valid --email is required");
  if (!options.name?.trim() || !options.organization?.trim())
    throw new Error("--name and --organization are required");
  if (!/^[a-z0-9][a-z0-9-]{0,38}$/.test(options.slug ?? ""))
    throw new Error(
      "--slug must be lowercase letters, numbers, and dashes (at most 39 characters)",
    );
  if (options.remote && options.local) throw new Error("Choose --remote or --local");
  if (!options.remote && !options.local) throw new Error("Specify --remote or --local");
  if (options.remote && options["persist-to"]) throw new Error("--persist-to is only for --local");
  if (options.local && options.env) throw new Error("--env is only for --remote");
  return options;
}

function wrangler(args, env) {
  const result = spawnSync(
    "wrangler",
    ["d1", "execute", "DB", "--config", "wrangler.jsonc", ...(env ? ["--env", env] : []), ...args],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Wrangler failed");
  return result.stdout;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildInitSql({ email, name, organization, slug, passwordHash, ids, now }) {
  const user = sqlString(ids.user);
  const org = sqlString(ids.organization);
  return [
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${user}, ${sqlString(name)}, ${sqlString(email.toLowerCase())}, 0, ${now}, ${now});`,
    `INSERT INTO account (id, user_id, account_id, provider_id, password, created_at, updated_at) VALUES (${sqlString(ids.account)}, ${user}, ${user}, 'credential', ${sqlString(passwordHash)}, ${now}, ${now});`,
    `INSERT INTO organization (id, name, slug, created_at) VALUES (${org}, ${sqlString(organization)}, ${sqlString(slug)}, ${now});`,
    `INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${sqlString(ids.member)}, ${org}, ${user}, 'owner', ${now});`,
  ].join("\n");
}

async function hiddenPassword() {
  if (process.env.FORGIT_INIT_PASSWORD) return process.env.FORGIT_INIT_PASSWORD;
  if (!process.stdin.isTTY)
    throw new Error("A terminal is required for the password prompt (or set FORGIT_INIT_PASSWORD)");
  process.stdout.write("Owner password: ");
  return new Promise((resolve, reject) => {
    let password = "";
    const finish = (error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(password);
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u0003") return finish(new Error("Cancelled"));
        if (character === "\u007f") password = password.slice(0, -1);
        else password += character;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function main() {
  const options = optionsFromArgs(process.argv.slice(2));
  const target = options.remote ? "--remote" : "--local";
  const persistence = options["persist-to"] ? ["--persist-to", options["persist-to"]] : [];
  const query = wrangler(
    [target, ...persistence, "--command", "SELECT COUNT(*) AS count FROM organization", "--json"],
    options.env,
  );
  const results = JSON.parse(query.slice(query.indexOf("[")));
  if (results[0]?.results?.[0]?.count !== 0)
    throw new Error("This instance already has an organization; init only runs once");
  const password = await hiddenPassword();
  if (password.length < 8 || password.length > 128)
    throw new Error("Password must be 8 to 128 characters");
  const directory = await mkdtemp(join(tmpdir(), "forgit-init-"));
  try {
    const file = join(directory, "init.sql");
    await writeFile(
      file,
      buildInitSql({
        ...options,
        passwordHash: await hashPassword(password),
        ids: {
          user: randomUUID(),
          account: randomUUID(),
          organization: randomUUID(),
          member: randomUUID(),
        },
        now: Date.now(),
      }),
      { mode: 0o600 },
    );
    wrangler([target, ...persistence, "--file", file, "--yes"], options.env);
    console.log(
      `Created ${options.organization} and owner ${options.email}. Sign in at the instance URL.`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
