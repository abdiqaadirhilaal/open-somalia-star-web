const AUTH = {
    currentUser: null,
    userRole: null,
    userData: null,

    async login(studentId, password, role) {
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: studentId, password, role })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Invalid credentials');

            this.currentUser = { uid: result.data.uid || result.data.studentId, ...result.data };
            this.userRole = result.role;
            this.userData = result.data;

            localStorage.setItem('somstar_user', JSON.stringify({
                id: studentId,
                role: result.role,
                name: result.data.fullName || result.data.name || studentId,
                uid: result.data.uid || 'manager'
            }));

            return { success: true, role: result.role, data: result.data };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    logout() {
        localStorage.removeItem('somstar_user');
        this.currentUser = null;
        this.userRole = null;
        this.userData = null;
        const isSubdir = window.location.pathname.includes('/manager/') || window.location.pathname.includes('/teacher/') || window.location.pathname.includes('/student/') || window.location.pathname.includes('/finance/') || window.location.pathname.includes('/supervisor/') || window.location.pathname.includes('/practice-teacher/');
        window.location.href = isSubdir ? '../index.html' : 'index.html';
    },

    checkAuth() {
        const saved = localStorage.getItem('somstar_user');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.currentUser = { uid: data.uid };
                this.userRole = data.role;
                this.userData = data;
                return data;
            } catch (e) {
                return null;
            }
        }
        return null;
    },

    redirectToDashboard(role) {
        switch (role) {
            case 'manager': window.location.href = 'manager/index.html'; break;
            case 'teacher': window.location.href = 'teacher/index.html'; break;
            case 'student': window.location.href = 'student/index.html'; break;
            case 'finance': window.location.href = 'finance/index.html'; break;
            case 'supervisor': window.location.href = 'supervisor/index.html'; break;
            case 'practice-teacher': window.location.href = 'practice-teacher/index.html'; break;
            default: window.location.href = 'login.html';
        }
    }
};