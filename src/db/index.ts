import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(config.dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function migrate(): void {
  const db = getDb();

  // Apply schema
  const schemaPath = path.join(import.meta.dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  // Check if categories are seeded
  const count = db.prepare('SELECT COUNT(*) as n FROM categories').get() as { n: number };
  if (count.n === 0) {
    const seedPath = path.join(import.meta.dirname, 'seed-categories.sql');
    const seed = fs.readFileSync(seedPath, 'utf-8');
    db.exec(seed);
    console.log('Seeded %d categories', (db.prepare('SELECT COUNT(*) as n FROM categories').get() as { n: number }).n);
  }

  // Record schema version
  const version = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
  if (!version.v || version.v < 1) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
  }

  console.log('Database ready at', config.dbPath);
}
