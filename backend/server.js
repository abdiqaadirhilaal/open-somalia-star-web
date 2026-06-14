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

// Serve uploaded files — with DB fallback
app.use('/uploads', express.static(uploadDir));
app.get('/uploads/:filename', async (req, res) => {
    const filePath = path.join(uploadDir, req.params.filename);
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
    try {
        const lessons = await db.getAll('lessons');
        const lesson = lessons.find(l => l.fileUrl === '/uploads/' + req.params.filename && l.dataUrl);
        if (lesson) {
            const data = lesson.dataUrl.split(',')[1] || lesson.dataUrl;
            const buf = Buffer.from(data, 'base64');
            const ext = path.extname(req.params.filename).toLowerCase();
            const mime = { '.pdf':'application/pdf','.mp4':'video/mp4','.mp3':'audio/mpeg','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }[ext] || 'application/octet-stream';
            res.set('Content-Type', mime);
            return res.send(buf);
        }
    } catch(e) {}
    res.status(404).send('File not found');
});

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
    const info = db.getDbInfo();
    res.json({
        status: 'ok',
        database: info.type,
        connected: info.connected,
        timestamp: info.timestamp,
        uptime: process.uptime(),
        memory: process.memoryUsage().rss
    });
});

// Lightweight db-status for frontend badge
app.get('/api/db-status', (req, res) => {
    res.json(db.getDbInfo());
});

// ====== Authentication ======

// POST /api/login — authenticate user and return user data (server-side)
app.post('/api/login', async (req, res) => {
    try {
        const { userId, password, role } = req.body;
        if (!userId || !password || !role) {
            return res.status(400).json({ error: 'userId, password, and role required' });
        }

        if (role === 'manager') {
            if (userId === 'MANAGER' && password === 'somalistar12345') {
                return res.json({ success: true, role: 'manager', data: { name: 'Manager', uid: 'manager' } });
            }
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (role === 'student') {
            const rows = await db.queryByChild('students', 'studentId', userId);
            if (!rows || rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
            const student = rows[0];
            if (student.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
            if (student.status === 'disabled') return res.status(403).json({ error: 'Account disabled. Contact manager.' });
            return res.json({ success: true, role: 'student', data: { uid: student.uid, ...student } });
        }

        if (role === 'teacher') {
            const rows = await db.queryByChild('teachers', 'teacherId', userId);
            if (!rows || rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
            const teacher = rows[0];
            if (teacher.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
            return res.json({ success: true, role: 'teacher', data: { uid: teacher.uid, ...teacher } });
        }

        return res.status(400).json({ error: 'Invalid role' });
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/change-password — allow password changes (manager only)
app.post('/api/change-password', async (req, res) => {
    try {
        const { targetRole, targetId, newPassword } = req.body;
        if (!targetRole || !targetId || !newPassword) {
            return res.status(400).json({ error: 'targetRole, targetId, and newPassword required' });
        }
        if (newPassword.length < 4) {
            return res.status(400).json({ error: 'Password must be at least 4 characters' });
        }

        if (targetRole === 'student') {
            const rows = await db.queryByChild('students', 'studentId', targetId);
            if (!rows || rows.length === 0) return res.status(404).json({ error: 'Student not found' });
            await db.update('students', rows[0].uid, { password: newPassword });
            return res.json({ success: true });
        }

        if (targetRole === 'teacher') {
            const rows = await db.queryByChild('teachers', 'teacherId', targetId);
            if (!rows || rows.length === 0) return res.status(404).json({ error: 'Teacher not found' });
            await db.update('teachers', rows[0].uid, { password: newPassword });
            return res.json({ success: true });
        }

        return res.status(400).json({ error: 'Invalid role' });
    } catch (e) {
        console.error('Change password error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Migration: convert existing file-based lessons to have dataUrl in DB
async function migrateLessonFiles() {
    try {
        const lessons = await db.getAll('lessons');
        for (const lesson of lessons) {
            if (lesson.fileUrl && !lesson.dataUrl) {
                const filePath = path.join(uploadDir, path.basename(lesson.fileUrl));
                if (fs.existsSync(filePath)) {
                    const fileData = fs.readFileSync(filePath).toString('base64');
                    const ext = path.extname(lesson.fileName || '').toLowerCase();
                    const mime = { '.pdf':'application/pdf','.mp4':'video/mp4','.mp3':'audio/mpeg','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.jpg':'image/jpeg','.png':'image/png','.gif':'image/gif' }[ext] || 'application/octet-stream';
                    await db.update('lessons', lesson.uid, { dataUrl: `data:${mime};base64,${fileData}` });
                    console.log(`  ✓ Migrated lesson file: ${lesson.fileName}`);
                }
            }
        }
    } catch(e) { console.error('Migration error:', e.message); }
}

// Daily keepalive to prevent Supabase auto-pause
let keepaliveInterval = null;
function startKeepalive() {
    if (keepaliveInterval) clearInterval(keepaliveInterval);
    keepaliveInterval = setInterval(() => db.keepAlive(), 6 * 60 * 60 * 1000); // every 6 hours
    console.log('  ✓ Database keepalive scheduled (every 6 hours)');
}

// Prevent crash on unhandled rejections
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

// Start server
db.initDB().then(async () => {
    await db.migrateIfNeeded();
    await seedDefaults();
    await migrateLessonFiles();
    // First keepalive after 5 minutes, then every 6 hours
    setTimeout(() => db.keepAlive(), 5 * 60 * 1000);
    startKeepalive();
    if (!process.env.DATABASE_URL) {
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
            const dbType = db.isUsingPostgres() ? 'PostgreSQL' : 'SQLite (PostgreSQL unavailable)';
            console.log('========================================');
            console.log('  SOMSTAR Academy - Production');
            console.log('========================================');
            console.log(`  Server running on port ${PORT}`);
            console.log(`  Database: ${dbType}`);
            console.log('========================================');
        });
    }
}).catch(err => {
    console.error('Failed to initialize database:', err);
    console.log('Starting server without database — some features may not work');
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT} (limited mode)`);
    });
});
