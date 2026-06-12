const SOMSTAR = {
    showNotification(message, type = 'info') {
        const existing = document.querySelector('.notification');
        if (existing) existing.remove();
        const n = document.createElement('div');
        n.className = `notification ${type}`;
        n.innerHTML = `<div class="flex items-center gap-2"><i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i> ${message}</div>`;
        document.body.appendChild(n);
        requestAnimationFrame(() => n.classList.add('show'));
        setTimeout(() => { n.classList.remove('show'); setTimeout(() => n.remove(), 400); }, 3000);
    },

    generateId(index) {
        const num = Math.min(100 + index, 300);
        return `SOMSTAR${num}`;
    },

    formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    },

    getToday() {
        return new Date().toISOString().split('T')[0];
    },

    toggleDarkMode() {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        localStorage.setItem('somstar_dark', isDark ? 'true' : 'false');
        const icon = document.querySelector('#darkModeToggle i');
        if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    },

    initDarkMode() {
        if (localStorage.getItem('somstar_dark') === 'true') {
            document.body.classList.add('dark-mode');
        }
    },

    loadSidebar() {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebarToggle');
        if (toggle) {
            toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
        }
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 && sidebar && !sidebar.contains(e.target) && e.target !== toggle) {
                sidebar.classList.remove('open');
            }
        });
    },

    setupLogout() {
        document.querySelectorAll('.logout-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                AUTH.logout();
            });
        });
    },

    searchTable(inputId, tableId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        input.addEventListener('keyup', function () {
            const q = this.value.toLowerCase();
            const rows = document.querySelectorAll(`#${tableId} tbody tr`);
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(q) ? '' : 'none';
            });
        });
    },

    async getNextStudentId() {
        const snap = await db.ref('students').once('value');
        const data = snap.val();
        if (!data) return 'SOMSTAR100';
        const ids = Object.values(data).map(s => s && s.studentId ? parseInt(s.studentId.replace('SOMSTAR', '')) : NaN).filter(n => !isNaN(n));
        const max = ids.length > 0 ? Math.max(...ids) : 99;
        const next = max + 1;
        return `SOMSTAR${next}`;
    },

    async getStudents() {
        const snap = await db.ref('students').once('value');
        const data = snap.val();
        if (!data) return [];
        return Object.keys(data).map(key => ({ uid: key, ...data[key] }));
    },

    async getTeachers() {
        const snap = await db.ref('teachers').once('value');
        const data = snap.val();
        if (!data) return [];
        return Object.keys(data).map(key => ({ uid: key, ...data[key] }));
    },

    async getAttendance(studentId) {
        const snap = await db.ref('attendance').orderByChild('studentId').equalTo(studentId).once('value');
        return snap.val() ? Object.values(snap.val()) : [];
    },

    async getMarks(studentId) {
        const snap = await db.ref('marks').orderByChild('studentId').equalTo(studentId).once('value');
        return snap.val() ? Object.values(snap.val()) : [];
    },

    async getQuizzes() {
        const snap = await db.ref('quizzes').once('value');
        return snap.val() ? Object.values(snap.val()) : [];
    },

    async getClasses() {
        const snap = await db.ref('classes').once('value');
        return snap.val() ? Object.values(snap.val()) : [];
    },

    exportToPDF(elementId, filename) {
        const element = document.getElementById(elementId);
        if (!element) { this.showNotification('Element not found', 'error'); return; }
        const opt = {
            margin: 0.5,
            filename: filename || 'report.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
        };
        html2pdf().set(opt).from(element).save();
    }
};
