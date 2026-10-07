import { createScratchDb, type ScratchDb } from './helpers/db';

let db: ScratchDb | undefined;

export async function setup() {
  db = createScratchDb();
  process.env.DATABASE_URL = db.url;
  process.env.NODE_ENV = 'development';
}

export async function teardown() {
  db?.drop();
}
