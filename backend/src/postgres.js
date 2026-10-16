import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

const { Pool, types } = pg;

// Keep API payloads compatible with the former SQLite driver: COUNT/SUM/AVG
// values should be JavaScript numbers rather than PostgreSQL int8/numeric strings.
types.setTypeParser(20, value => Number(value)); // int8 / bigint
types.setTypeParser(1700, value => Number(value)); // numeric / decimal
const databaseUrl = process.env.DATABASE_URL || '';
if (!databaseUrl) console.warn('DATABASE_URL is not set. PostgreSQL calls will fail until it is configured.');

const isLocalDatabase = /(?:localhost|127\.0\.0\.1)(?::\d+)?\//i.test(databaseUrl);
const sslDisabled = process.env.PGSSL === 'false' || isLocalDatabase;
const poolOptions = {
  connectionString: databaseUrl || undefined,
  max: Math.max(1, Number(process.env.PG_POOL_MAX || (process.env.VERCEL ? 3 : 10))),
  idleTimeoutMillis: Math.max(5_000, Number(process.env.PG_IDLE_TIMEOUT_MS || 30_000)),
  connectionTimeoutMillis: Math.max(2_000, Number(process.env.PG_CONNECT_TIMEOUT_MS || 10_000)),
  allowExitOnIdle: !process.env.VERCEL,
  ...(sslDisabled ? {} : { ssl: { rejectUnauthorized: false } })
};

const globalPoolKey = '__calamellePostgresPool';
export const pool = globalThis[globalPoolKey] || new Pool(poolOptions);
if (!globalThis[globalPoolKey]) globalThis[globalPoolKey] = pool;
pool.on('error', error => console.error('Unexpected PostgreSQL pool error:', error));

const transactionStorage = globalThis.__calamellePgTransactionStorage || new AsyncLocalStorage();
if (!globalThis.__calamellePgTransactionStorage) globalThis.__calamellePgTransactionStorage = transactionStorage;

function replaceQuestionPlaceholders(sql) {
  let index = 0, out = '', single = false, double = false, dollarTag = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i], next = sql[i + 1];
    if (!single && !double && ch === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        if (dollarTag === tag) dollarTag = null; else if (!dollarTag) dollarTag = tag;
        out += tag; i += tag.length - 1; continue;
      }
    }
    if (dollarTag) { out += ch; continue; }
    if (!double && ch === "'") {
      out += ch;
      if (single && next === "'") { out += next; i += 1; continue; }
      single = !single; continue;
    }
    if (!single && ch === '"') { out += ch; double = !double; continue; }
    if (!single && !double && ch === '?') { index += 1; out += `$${index}`; continue; }
    out += ch;
  }
  return out;
}

function translateInsertOrIgnore(sql) {
  if (!/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql)) return sql;
  let translated = sql.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
  const semicolon = /;\s*$/.test(translated);
  translated = translated.replace(/;\s*$/, '').trimEnd();
  translated += ' ON CONFLICT DO NOTHING';
  return semicolon ? `${translated};` : translated;
}

export function translateSql(sql) {
  let translated = String(sql || '');
  translated = translated.replace(/\bBEGIN\s+IMMEDIATE\b/gi, 'BEGIN');
  translated = translateInsertOrIgnore(translated);
  translated = translated.replace(/\sLIKE\s/gi, ' ILIKE ');
  return replaceQuestionPlaceholders(translated);
}

function currentExecutor() { return transactionStorage.getStore()?.client || pool; }

function makeDatabase(executorProvider, { supportsManualTransactions = false } = {}) {
  const query = async (sql, params = []) => executorProvider().query(translateSql(sql), params);

  const database = {
    prepare(sql) {
      return {
        async get(...params) { const result = await query(sql, params); return result.rows[0]; },
        async all(...params) { const result = await query(sql, params); return result.rows; },
        async run(...params) {
          const result = await query(sql, params);
          return { changes: result.rowCount || 0, rowCount: result.rowCount || 0, rows: result.rows || [] };
        }
      };
    },

    async exec(sql) {
      const translated = translateSql(sql).trim();
      if (supportsManualTransactions && /^BEGIN\b/i.test(translated)) {
        if (transactionStorage.getStore()?.client) throw new Error('Nested manual PostgreSQL transactions are not supported.');
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          transactionStorage.enterWith({ client });
          return { rowCount: 0, rows: [] };
        } catch (error) { client.release(); throw error; }
      }
      if (supportsManualTransactions && /^(COMMIT|ROLLBACK)\b/i.test(translated)) {
        const store = transactionStorage.getStore();
        if (!store?.client) return { rowCount: 0, rows: [] };
        try { return await store.client.query(/^COMMIT/i.test(translated) ? 'COMMIT' : 'ROLLBACK'); }
        finally { store.client.release(); transactionStorage.enterWith(null); }
      }
      return executorProvider().query(translated);
    },

    async query(sql, params = []) { return query(sql, params); },

    async bulkInsert(table, columns, rows, { onConflict = 'NOTHING', chunkSize = 250 } = {}) {
      if (!rows?.length) return 0;
      const safeIdentifier = value => {
        if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
        return `"${value}"`;
      };
      const tableSql = safeIdentifier(table);
      const columnSql = columns.map(safeIdentifier).join(',');
      let inserted = 0;
      for (let start = 0; start < rows.length; start += chunkSize) {
        const chunk = rows.slice(start, start + chunkSize);
        const params = [];
        const valuesSql = chunk.map(row => `(${columns.map(column => { params.push(row[column] ?? null); return `$${params.length}`; }).join(',')})`).join(',');
        const conflictSql = onConflict === 'NOTHING' ? ' ON CONFLICT DO NOTHING' : '';
        const result = await executorProvider().query(`INSERT INTO ${tableSql} (${columnSql}) VALUES ${valuesSql}${conflictSql}`, params);
        inserted += result.rowCount || 0;
      }
      return inserted;
    }
  };
  return database;
}

export const db = makeDatabase(currentExecutor, { supportsManualTransactions: true });

db.transaction = async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await transactionStorage.run({ client }, async () => {
      const tx = makeDatabase(() => client);
      try {
        const value = await callback(tx);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
      }
    });
  } finally { client.release(); }
};

export async function closeDatabasePool() { await pool.end(); }
