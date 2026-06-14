const path = require('path');
const fs = require('fs');

const isPostgres = !!process.env.DATABASE_URL;
let pgPool = null;
let sqliteDb = null;
let _reconnectTimer = null;
let _pgError = null;

const DB_PATH = path.join(__dirname, 'data', 'somstar.db');
const dataDir = path.dirname(DB_PATH);

function saveSQLite() {
    if (!sqliteDb) return;
    const data = sqliteDb.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function _tryConnectPostgres() {
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 20000,
        max: 5
    });
    const test = await pool.query('SELECT 1 AS ok');
    if (!test || !test.rows) throw new Error('No response from database');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS data (
            collection TEXT NOT NULL,
            uid TEXT NOT NULL,
            json TEXT NOT NULL,
            "createdAt" TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
            PRIMARY KEY (collection, uid)
        )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_collection ON data(collection)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_collection_created ON data(collection, "createdAt")');
    return pool;
}

async function _scheduleReconnect() {
    if (_reconnectTimer) clearTimeout(_reconnectTimer);
    _reconnectTimer = setTimeout(async () => {
        console.log('  → Attempting PostgreSQL reconnection...');
        try {
            const pool = await _tryConnectPostgres();
            pgPool = pool;
            _reconnectTimer = null;
            console.log('  ✓ PostgreSQL reconnected successfully');

            // Migrate any SQLite data to PostgreSQL
            if (sqliteDb) {
                try {
                    const stmt = sqliteDb.prepare('SELECT collection, uid, json, createdAt FROM data ORDER BY collection, createdAt');
                    while (stmt.step()) {
                        const row = stmt.getAsObject();
                        await pgPool.query(
                            'INSERT INTO data (collection, uid, json, "createdAt") VALUES ($1, $2, $3, $4) ON CONFLICT (collection, uid) DO NOTHING',
                            [row.collection, row.uid, row.json, row.createdAt]
                        );
                    }
                    stmt.free();
                    console.log('  ✓ SQLite data migrated to PostgreSQL');
                } catch(e) {
                    console.error('  ✗ Migration error:', e.message);
                }
            }
        } catch(e) {
            _pgError = e.message;
            console.error('  ✗ Reconnection failed:', e.message.slice(0, 100));
            _scheduleReconnect();
        }
    }, 30000); // Try again in 30 seconds
}

async function initDB() {
    if (isPostgres) {
        try {
            pgPool = await _tryConnectPostgres();
            console.log('  ✓ Connected to PostgreSQL');
            return;
        } catch(e) {
            _pgError = e.message;
            console.error('  ✗ PostgreSQL connection failed:', e.message);
            if (e.message && e.message.includes('timeout')) {
                console.log('  → Connection timed out. Check if Supabase project is active.');
                console.log('  → Visit https://supabase.com/dashboard/project/rlztilksthbcvsioyzxi to unpause.');
            } else if (e.message && e.message.includes('ENOTFOUND')) {
                console.log('  → User/tenant not found — database project may be PAUSED.');
                console.log('  → Check your database provider dashboard.');
            } else if (e.message && e.message.includes('password')) {
                console.log('  → Password may be wrong. Verify in Supabase dashboard.');
            }
            console.log('  → Falling back to SQLite temporarily. Will retry PostgreSQL every 30s.');
            pgPool = null;
        }
    }
    const initSqlJs = require('sql.js');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(DB_PATH)) {
        sqliteDb = new (await initSqlJs()).Database(fs.readFileSync(DB_PATH));
    } else {
        sqliteDb = new (await initSqlJs()).Database();
    }
    sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS data (
            collection TEXT NOT NULL,
            uid TEXT NOT NULL,
            json TEXT NOT NULL,
            createdAt TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (collection, uid)
        );
        CREATE INDEX IF NOT EXISTS idx_collection ON data(collection);
        CREATE INDEX IF NOT EXISTS idx_collection_created ON data(collection, createdAt);
    `);
    saveSQLite();
    if (isPostgres) {
        _scheduleReconnect();
    }
}

async function runQuery(sql, params) {
    if (pgPool) {
        const res = await pgPool.query(sql, params);
        return res;
    }
    if (!sqliteDb) return null;
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
        const stmt = sqliteDb.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return { rows };
    }
    sqliteDb.run(sql, params);
    saveSQLite();
    return null;
}

async function getAll(collection) {
    if (pgPool) {
        const res = await pgPool.query('SELECT uid, json, "createdAt" FROM data WHERE collection = $1 ORDER BY "createdAt" DESC', [collection]);
        return res.rows.map(r => { let d = {}; try { d = JSON.parse(r.json); } catch(e) {} return { uid: r.uid, ...d }; });
    }
    const stmt = sqliteDb.prepare('SELECT uid, json, createdAt FROM data WHERE collection = ? ORDER BY createdAt DESC');
    stmt.bind([collection]);
    const rows = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        let d = {}; try { d = JSON.parse(row.json); } catch(e) {}
        rows.push({ uid: row.uid, ...d });
    }
    stmt.free();
    return rows;
}

async function getByUid(collection, uid) {
    if (pgPool) {
        const res = await pgPool.query('SELECT json FROM data WHERE collection = $1 AND uid = $2', [collection, uid]);
        if (res.rows.length === 0) return null;
        let d = {}; try { d = JSON.parse(res.rows[0].json); } catch(e) {}
        return { uid, ...d };
    }
    const stmt = sqliteDb.prepare('SELECT json FROM data WHERE collection = ? AND uid = ?');
    stmt.bind([collection, uid]);
    if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        let d = {}; try { d = JSON.parse(row.json); } catch(e) {}
        return { uid, ...d };
    }
    stmt.free();
    return null;
}

async function insert(collection, data) {
    const uid = data.uid || 'k' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    const { uid: _u, ...rest } = data;
    const json = JSON.stringify(rest);
    const now = new Date().toISOString();
    if (pgPool) {
        await pgPool.query(
            'INSERT INTO data (collection, uid, json, "createdAt") VALUES ($1, $2, $3, $4) ON CONFLICT (collection, uid) DO UPDATE SET json = $3',
            [collection, uid, json, now]
        );
    } else {
        sqliteDb.run('INSERT OR REPLACE INTO data (collection, uid, json, createdAt) VALUES (?, ?, ?, ?)',
            [collection, uid, json, now]);
        saveSQLite();
    }
    return uid;
}

async function update(collection, uid, data) {
    const existing = await getByUid(collection, uid);
    if (!existing) { await insert(collection, { uid, ...data }); return; }
    const { uid: _u, ...rest } = data;
    const merged = { ...existing, ...rest };
    delete merged.uid;
    const json = JSON.stringify(merged);
    if (pgPool) {
        await pgPool.query('UPDATE data SET json = $1 WHERE collection = $2 AND uid = $3', [json, collection, uid]);
    } else {
        sqliteDb.run('UPDATE data SET json = ? WHERE collection = ? AND uid = ?', [json, collection, uid]);
        saveSQLite();
    }
}

async function remove(collection, uid) {
    if (pgPool) {
        await pgPool.query('DELETE FROM data WHERE collection = $1 AND uid = $2', [collection, uid]);
    } else {
        sqliteDb.run('DELETE FROM data WHERE collection = ? AND uid = ?', [collection, uid]);
        saveSQLite();
    }
}

async function queryByChild(collection, childKey, childValue) {
    const all = await getAll(collection);
    return all.filter(item => String(item[childKey]) === String(childValue));
}

async function keepAlive() {
    if (pgPool) {
        try {
            await pgPool.query('SELECT 1');
            console.log('  ✓ Database keepalive ping');
        } catch(e) {
            console.error('  ✗ Keepalive failed:', e.message.slice(0, 100));
            pgPool = null;
            _scheduleReconnect();
        }
    }
}

function getDbInfo() {
    return {
        type: pgPool ? 'postgresql' : 'sqlite',
        connected: pgPool !== null || sqliteDb !== null,
        hasPostgres: pgPool !== null,
        pgError: pgPool ? null : _pgError,
        timestamp: new Date().toISOString()
    };
}

async function migrateIfNeeded() {
    if (pgPool) return; // No migration needed for active PG database
    const tables = sqliteDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('data', 'sqlite_sequence')");
    if (!tables || tables.length === 0 || !tables[0].values) return;
    const oldTables = tables[0].values.map(v => v[0]);
    oldTables.forEach(table => {
        try {
            const cols = sqliteDb.exec(`PRAGMA table_info(${table})`);
            if (cols.length > 0) {
                const stmt2 = sqliteDb.prepare(`SELECT * FROM ${table}`);
                while (stmt2.step()) {
                    const row = stmt2.getAsObject();
                    const { uid, ...rest } = row;
                    if (uid) {
                        sqliteDb.run('INSERT OR IGNORE INTO data (collection, uid, json, createdAt) VALUES (?, ?, ?, ?)',
                            [table, uid, JSON.stringify(rest), rest.createdAt || new Date().toISOString()]);
                    }
                }
                stmt2.free();
            }
            sqliteDb.exec(`DROP TABLE IF EXISTS ${table}`);
        } catch(e) {}
    });
    saveSQLite();
}

module.exports = { initDB, getDB: () => sqliteDb, getAll, getByUid, insert, update, remove, queryByChild, migrateIfNeeded, isUsingPostgres: () => pgPool !== null, keepAlive, getDbInfo };
