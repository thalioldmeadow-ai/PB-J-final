/**
 * Run the real two-connection Supabase concurrency test against an ephemeral
 * local PostgreSQL cluster. This is for verification only: it does not connect
 * to Supabase, read the live JSON ledgers, or require Docker.
 *
 * Usage: npm run supabase:concurrency:local
 */

import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const dir = path.join(root, ".tmp", `phase1-pg-${process.pid}`);
const port = Number(process.env.SUPABASE_TEST_PORT || 55432);
const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/phase1`;
let started = false;

fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: false,
  autoRehydrateSymlinks: true,
  initdbFlags: ["--no-sync"],
  onLog: () => {},
  onError: () => {},
});

try {
  await pg.initialise();
  await pg.start();
  started = true;
  await pg.createDatabase("phase1");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(`
    create schema if not exists auth;

    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;

    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);

  const migrationDir = path.join(root, "supabase", "migrations");
  for (const migration of fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort()) {
    await client.query(fs.readFileSync(path.join(migrationDir, migration), "utf8"));
  }
  await client.end();

  const child = spawn(
    path.join(root, "node_modules", ".bin", "tsx"),
    [path.join("tests", "supabase-concurrency.test.ts")],
    { cwd: root, env: { ...process.env, SUPABASE_TEST_DB_URL: databaseUrl }, stdio: "inherit" },
  );
  const code = await new Promise((resolve) => child.on("exit", resolve));
  if (code !== 0) process.exitCode = 1;
} catch (error) {
  console.error("Embedded Postgres concurrency test failed.", error);
  process.exitCode = 1;
} finally {
  if (started) await pg.stop().catch(() => undefined);
  fs.rmSync(dir, { recursive: true, force: true });
}
