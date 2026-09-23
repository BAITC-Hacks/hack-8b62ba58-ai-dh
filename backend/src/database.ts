import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { seed, type Task } from './domain.ts';
export type TaskRow = { id: string; working: string; public_snapshot: string | null; revision: number; confirmed_revision: number | null };
export type ProposalRow = { id: string; task_id: string; team_id: string; idea: string; plan: string; deadline: string; url: string; status: 'pending' | 'selected' | 'rejected'; revision: number; created_at: string };
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function openDatabase(filename: string, seedData = true) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS schema_meta(version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks(
      id TEXT PRIMARY KEY, working TEXT NOT NULL CHECK(json_valid(working)),
      public_snapshot TEXT CHECK(public_snapshot IS NULL OR json_valid(public_snapshot)),
      revision INTEGER NOT NULL CHECK(revision > 0), confirmed_revision INTEGER
    );
    CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY, name TEXT NOT NULL, interests TEXT NOT NULL, skills TEXT NOT NULL, technologies TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS proposals(
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), team_id TEXT NOT NULL REFERENCES teams(id),
      idea TEXT NOT NULL, plan TEXT NOT NULL, deadline TEXT NOT NULL, url TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','selected','rejected')), revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS proposals_task ON proposals(task_id);
    CREATE TABLE IF NOT EXISTS milestones(
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), team_id TEXT NOT NULL REFERENCES teams(id),
      stage TEXT NOT NULL CHECK(stage IN ('prototype','pilot')), points INTEGER NOT NULL CHECK(points = 25),
      evidence TEXT NOT NULL, confirmed_at TEXT NOT NULL, UNIQUE(task_id, team_id, stage)
    );
  `);
  const version = db.prepare('SELECT version FROM schema_meta LIMIT 1').get();
  if (!version) transaction(db, () => {
    db.prepare('INSERT INTO schema_meta VALUES (1)').run();
    if (!seedData) return;
    const h = seed();
    for (const t of h.tasks) db.prepare('INSERT INTO tasks VALUES (?, ?, ?, 1, 1)').run(t.id, JSON.stringify(t), JSON.stringify(t));
    for (const t of h.teams) db.prepare('INSERT INTO teams VALUES (?, ?, ?, ?, ?)').run(t.id, t.name, t.interests, t.skills, t.technologies);
    for (const p of h.proposals) db.prepare('INSERT INTO proposals VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)').run(p.id, p.taskId, p.teamId, p.idea, p.plan, p.deadline, p.url, p.status, new Date().toISOString());
  });
  else if (version.version !== 1) { db.close(); throw new Error('Unsupported database schema'); }
  return db;
}
export function working(row: TaskRow): Task { return JSON.parse(row.working); }
