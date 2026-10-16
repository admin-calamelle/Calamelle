import { initializeDatabase } from './db.js';
import { closeDatabasePool } from './postgres.js';

try {
  await initializeDatabase({
    seedContent: true,
    seedDemo: process.env.SEED_DEMO_DATA === 'true'
  });
  console.log('PostgreSQL setup complete.');
} finally {
  await closeDatabasePool();
}
