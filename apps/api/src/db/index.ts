import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
import * as schema from './schema.js';

const { Pool } = pkg;

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: InstanceType<typeof Pool> | null = null;

export function getDb() {
  if (!_db) {
    _pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    _db = drizzle(_pool, { schema });
  }
  return _db;
}

export async function closeDb() {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}

export { schema };
export type Db = ReturnType<typeof getDb>;
