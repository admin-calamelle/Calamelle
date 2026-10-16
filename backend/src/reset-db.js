import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'calamelle.db');
for (const suffix of ['', '-shm', '-wal']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.rmSync(p);
}
console.log('Database reset. It will be recreated with the complete Calamelle question bank on next start.');
