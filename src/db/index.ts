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

  // Migrations
  const version = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
  if (!version.v || version.v < 1) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
  }

  // v2: Add thinking column to messages
  if (!version.v || version.v < 2) {
    const cols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    if (!cols.some(c => c.name === 'thinking')) {
      db.exec("ALTER TABLE messages ADD COLUMN thinking TEXT");
    }
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(2);
  }

  // v3: Add SimpleFIN support
  if (!version.v || version.v < 3) {
    // simplefin_items table is created by schema.sql above (CREATE IF NOT EXISTS)
    const acctCols = db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[];
    if (!acctCols.some(c => c.name === 'simplefin_item_id')) {
      db.exec("ALTER TABLE accounts ADD COLUMN simplefin_item_id TEXT");
    }
    if (!acctCols.some(c => c.name === 'simplefin_account_id')) {
      db.exec("ALTER TABLE accounts ADD COLUMN simplefin_account_id TEXT");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_simplefin ON accounts(simplefin_account_id)");
    }
    const txnCols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
    if (!txnCols.some(c => c.name === 'simplefin_id')) {
      db.exec("ALTER TABLE transactions ADD COLUMN simplefin_id TEXT");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_simplefin ON transactions(simplefin_id)");
    }
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(3);
  }

  console.log('Database ready at', config.dbPath);
}
