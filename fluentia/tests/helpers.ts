import { migrate } from '../src/db/migrations';
import { bootstrap } from '../src/db/repo';
import { createNodeDb } from './nodeDb';

export async function freshDb(path = ':memory:') {
  const db = createNodeDb(path);
  await migrate(db);
  await bootstrap(db);
  return db;
}
