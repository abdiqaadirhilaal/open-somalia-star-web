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

// Serve static files from project root
app.use(express.static(path.join(__dirname, '..')));

// DB init helper
let _dbInit = null;
function _ensureDB() {
    if (!_dbInit) {
        _dbInit = db.initDB().then(async () => {
            await db.migrateIfNeeded();
            await seedDefaults();
            await migrateLessonFiles();
        });
    }
    return _dbInit;
}

// File upload config
const uploadDir = path.join(__dirname, 'data', 'uploads');
const storage = multer.diskStorage({
    destination: uploadDir,
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
        // Single item by uid → return data unwrapped (Firebase-compatible)
        if (uid && !field && rows.length === 1) {
            const { uid: _u, ...data } = rows[0];
            return res.json(data);
        }
        const result = {};
        const isCollection = !uid && !child;
        rows.forEach(r => {
            const { uid: rowUid, ...data } = r;
            // Omit bulky fields from collection responses for performance
            if (isCollection && data.dataUrl) data.dataUrl = undefined;
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
        const tables = ['students', 'teachers', 'attendance', 'teacherAttendance', 'marks', 'lessons', 'quizzes', 'announcements', 'classes', 'finance', 'discipline_reports', 'exam_results', 'subjects', 'notifications'];
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
        const tables = ['students', 'teachers', 'attendance', 'teacherAttendance', 'marks', 'lessons', 'quizzes', 'announcements', 'classes', 'finance', 'discipline_reports', 'exam_results', 'subjects', 'notifications'];
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
    // Teachers
    const existingTeachers = await db.getAll('teachers');
    if (existingTeachers.length === 0) {
        const teachers = [
            { name: 'Try', subject: 'General', teacherId: 'TCH001', contact: '', password: '@som1234' },
            { name: 'C.Shakuur', subject: 'General', teacherId: 'TCH002', contact: '', password: '@som1234' },
            { name: 'Muqtaar', subject: 'General', teacherId: 'TCH003', contact: '', password: '@som1234' },
            { name: 'Aadan', subject: 'Mathematics', teacherId: 'TCH004', contact: '', password: '@som1234' },
            { name: 'Cabdalah', subject: 'General', teacherId: 'TCH005', contact: '', password: '@som1234', role: 'practice-teacher', disciplineOnly: true }
        ];
        for (const t of teachers) await db.insert('teachers', t);
        console.log('  ✓ Teachers seeded');
    }

    // Classes — 10 general + 4 TRY
    const requiredClasses = [
        { name: 'Class 1', grade: '1' }, { name: 'Class 2', grade: '2' },
        { name: 'Class 3', grade: '3' }, { name: 'Class 4', grade: '4' },
        { name: 'Class 5', grade: '5' }, { name: 'Class 6', grade: '6' },
        { name: 'Class 7', grade: '7' }, { name: 'Class 8', grade: '8' },
        { name: 'Class 9', grade: '9' }, { name: 'Class 10', grade: '10' },
        { name: 'TRY 2:00', teacherId: 'TCH001' },
        { name: 'TRY 3:00', teacherId: 'TCH001' },
        { name: 'TRY 4:00', teacherId: 'TCH001' },
        { name: 'TRY 7:00', teacherId: 'TCH001' }
    ];
    const existingClasses = await db.getAll('classes');
    const existingNames = new Set(existingClasses.map(c => c.name));
    for (const c of requiredClasses) {
        if (!existingNames.has(c.name)) {
            await db.insert('classes', c);
        }
    }
    console.log(`  ✓ Classes: ${existingClasses.length} existing + new added`);

    // Subjects
    const existingSubjects = await db.getAll('subjects');
    if (existingSubjects.length === 0) {
        const subjects = [
            { name: 'English', code: 'ENG' },
            { name: 'Mathematics', code: 'MATH' },
            { name: 'Science', code: 'SCI' }
        ];
        for (const s of subjects) await db.insert('subjects', s);
        console.log('  ✓ Subjects seeded');
    }

    // Students SOMSTAR100-SOMSTAR500
    const existingStudents = await db.getAll('students');
    if (existingStudents.length === 0) {
        let count = 0;
        for (let id = 100; id <= 500; id++) {
            await db.insert('students', {
                studentId: 'SOMSTAR' + id,
                fullName: '',
                class: 'TRY 7:00',
                phone: '',
                password: '@som1234',
                status: 'active'
            });
            count++;
        }
        console.log(`  ✓ ${count} students seeded (SOMSTAR100-SOMSTAR500)`);
    }
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
        const { userId, password } = req.body;
        if (!userId || !password) {
            return res.status(400).json({ error: 'userId and password required' });
        }

        // Hardcoded accounts
        if (userId === 'MANAGER' && password === 'somalistar12345')
            return res.json({ success: true, role: 'manager', data: { name: 'Manager', uid: 'manager' } });
        if (userId === 'Saacid' && password === '@som1234')
            return res.json({ success: true, role: 'finance', data: { name: 'Saacid', uid: 'finance-saacid' } });
        if (userId === 'Cabaas' && password === '@som1234')
            return res.json({ success: true, role: 'supervisor', data: { name: 'Cabaas', uid: 'supervisor-cabaas' } });
        if (userId === 'Cabdalah' && password === '@som1234')
            return res.json({ success: true, role: 'practice-teacher', data: { name: 'Cabdalah', uid: 'practice-cabdalah' } });

        // Check teachers
        const teachers = await db.queryByChild('teachers', 'teacherId', userId);
        if (teachers.length > 0 && teachers[0].password === password) {
            const t = teachers[0];
            if (t.role === 'practice-teacher')
                return res.json({ success: true, role: 'practice-teacher', data: { uid: t.uid, ...t } });
            return res.json({ success: true, role: 'teacher', data: { uid: t.uid, ...t } });
        }

        // Check students
        const students = await db.queryByChild('students', 'studentId', userId);
        if (students.length > 0 && students[0].password === password) {
            const s = students[0];
            if (s.status === 'disabled') return res.status(403).json({ error: 'Account disabled. Contact manager.' });
            return res.json({ success: true, role: 'student', data: { uid: s.uid, ...s } });
        }

        return res.status(401).json({ error: 'Invalid credentials' });
    } catch (e) {
        console.error('Login error:', e);
        return res.status(500).json({ error: 'Server error' });
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
_ensureDB().then(() => {
    setTimeout(() => db.keepAlive(), 5 * 60 * 1000);
    startKeepalive();
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
        const dbType = db.isUsingPostgres() ? 'PostgreSQL' : 'SQLite';
        console.log('========================================');
        console.log('  SOMSTAR Academy Backend Server');
        console.log('========================================');
        console.log(`  Database: ${dbType}`);
        console.log(`  Local:    http://localhost:${PORT}`);
        console.log(`  Network:  http://${networkIP}:${PORT}`);
        console.log('========================================');
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    app.listen(PORT, '', () => {
        console.log(`Server running on port ${PORT} (limited mode)`);
    });
});
