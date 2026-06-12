const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// Serve static files from parent directory
app.use(express.static(path.join(__dirname, '..')));

// File upload config
const storage = multer.diskStorage({
    destination: path.join(__dirname, 'data', 'uploads'),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + '-' + Math.random().toString(36).substr(2, 6) + ext);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 200 * 1024 * 1024 } // 200MB
});

// Ensure upload dir exists
const uploadDir = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Serve uploaded files
app.use('/uploads', express.static(uploadDir));

// ====== API Routes ======

function parsePath(fullPath) {
    const parts = fullPath.split('/');
    const collection = parts[0];
    const uid = parts[1] || null;
    const field = parts[2] || null;
    return { collection, uid, field };
}

// Generic read — returns { key: data } or null
app.get('/api/ref/:path(*)', async (req, res) => {
    try {
        const { collection, uid, field } = parsePath(req.params.path);
        const { child, value } = req.query;
        let rows;
        if (uid && field) {
            const row = await db.getByUid(collection, uid);
            rows = row ? [{ uid, [field]: row[field] }] : [];
        } else if (uid) {
            const row = await db.getByUid(collection, uid);
            rows = row ? [row] : [];
        } else if (child && value !== undefined) {
            rows = await db.queryByChild(collection, child, value);
        } else {
            rows = await db.getAll(collection);
        }
        if (!rows || rows.length === 0) return res.json(null);
        const result = {};
        rows.forEach(r => {
            const { uid: rowUid, ...data } = r;
            result[rowUid] = data;
        });
        res.json(result);
    } catch (e) {
        console.error('GET error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Generic push — creates with auto-key and returns ref
app.post('/api/ref/:path(*)', async (req, res) => {
    try {
        const { collection } = parsePath(req.params.path);
        const data = req.body;
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Invalid data' });
        }
        const uid = await db.insert(collection, { ...data, createdAt: new Date().toISOString() });
        res.json({ key: uid });
    } catch (e) {
        console.error('POST error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Generic set — replaces data at exact path
app.put('/api/ref/:path(*)', async (req, res) => {
    try {
        const { collection, uid, field } = parsePath(req.params.path);
        const data = req.body;
        if (uid && field) {
            const existing = await db.getByUid(collection, uid);
            if (existing) {
                await db.update(collection, uid, { [field]: data });
            }
        } else if (uid) {
            await db.update(collection, uid, data);
        } else {
            if (data && typeof data === 'object') {
                const existing = await db.getAll(collection);
                for (const r of existing) await db.remove(collection, r.uid);
                for (const key of Object.keys(data)) {
                    await db.insert(collection, { ...data[key], createdAt: new Date().toISOString() });
                }
            }
        }
        res.json({ success: true });
    } catch (e) {
        console.error('PUT error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Generic update — merges data at path
app.patch('/api/ref/:path(*)', async (req, res) => {
    try {
        const { collection, uid, field } = parsePath(req.params.path);
        const data = req.body;
        if (uid && field) {
            const existing = await db.getByUid(collection, uid);
            if (existing) {
                await db.update(collection, uid, { [field]: data });
            }
        } else if (uid) {
            await db.update(collection, uid, data);
        }
        res.json({ success: true });
    } catch (e) {
        console.error('PATCH error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Generic remove
app.delete('/api/ref/:path(*)', async (req, res) => {
    try {
        const { collection, uid } = parsePath(req.params.path);
        if (uid) {
            await db.remove(collection, uid);
        }
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE error:', e);
        res.status(500).json({ error: e.message });
    }
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file' });
        const fileUrl = '/uploads/' + req.file.filename;
        const fileData = fs.readFileSync(req.file.path).toString('base64');
        const mime = req.file.mimetype || 'application/octet-stream';
        const dataUrl = `data:${mime};base64,${fileData}`;
        res.json({ url: fileUrl, name: req.file.originalname, type: req.file.mimetype, dataUrl });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete uploaded file
app.delete('/api/upload/:filename', (req, res) => {
    try {
        const filePath = path.join(uploadDir, req.params.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Serve uploaded files
app.use('/uploads', express.static(uploadDir));

// Export/Import
app.get('/api/export', async (req, res) => {
    try {
        const tables = ['students', 'teachers', 'attendance', 'teacherAttendance', 'marks', 'lessons', 'quizzes', 'announcements', 'classes', 'finance'];
        const data = {};
        for (const t of tables) {
            const rows = await db.getAll(t);
            if (rows.length > 0) {
                data[t] = {};
                rows.forEach(r => {
                    const { uid, ...rest } = r;
                    data[t][uid] = rest;
                });
            }
        }
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/import', async (req, res) => {
    try {
        const data = req.body;
        if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Invalid data' });
        const tables = ['students', 'teachers', 'attendance', 'teacherAttendance', 'marks', 'lessons', 'quizzes', 'announcements', 'classes', 'finance'];
        for (const t of tables) {
            if (data[t]) {
                const existing = await db.getAll(t);
                for (const r of existing) await db.remove(t, r.uid);
                for (const key of Object.keys(data[t])) {
                    await db.insert(t, { ...data[t][key], createdAt: new Date().toISOString() });
                }
            }
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Seed default teachers
async function seedDefaults() {
    const existing = await db.getAll('teachers');
    if (existing.length > 0) return;
    const teachers = [
        { name: 'Try', subject: 'General', teacherId: 'TCH001', contact: '', password: '@som1234' },
        { name: 'C.Shakuur', subject: 'General', teacherId: 'TCH002', contact: '', password: '@som1234' },
        { name: 'Muqtaar', subject: 'General', teacherId: 'TCH003', contact: '', password: '@som1234' }
    ];
    for (const t of teachers) await db.insert('teachers', t);
    console.log('  ✓ Default teachers seeded');
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const isLocal = !process.env.DATABASE_URL;
db.initDB().then(async () => {
    await db.migrateIfNeeded();
    await seedDefaults();
    if (isLocal) {
        let networkIP = 'Not found';
        const ifaces = os.networkInterfaces();
        for (const name of Object.keys(ifaces)) {
            for (const iface of ifaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    networkIP = iface.address;
                    break;
                }
            }
            if (networkIP !== 'Not found') break;
        }
        app.listen(PORT, '', () => {
            console.log('========================================');
            console.log('  SOMSTAR Academy Backend Server');
            console.log('========================================');
            console.log(`  Local:    http://localhost:${PORT}`);
            console.log(`  Network:  http://${networkIP}:${PORT}`);
            console.log('========================================');
            console.log('  Share the Network URL to access from');
            console.log('  your mobile phone or other devices');
            console.log('  on the same Wi-Fi network.');
            console.log('========================================');
        });
    } else {
        app.listen(PORT, '0.0.0.0', () => {
            console.log('========================================');
            console.log('  SOMSTAR Academy - Production');
            console.log('========================================');
            console.log(`  Server running on port ${PORT}`);
            console.log(`  Database: PostgreSQL`);
            console.log('========================================');
        });
    }
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
