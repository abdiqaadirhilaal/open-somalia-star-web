const AUTH = {
    currentUser: null,
    userRole: null,
    userData: null,

    async login(studentId, password, role) {
        try {
            const snapshot = await db.ref('students').orderByChild('studentId').equalTo(studentId).once('value');
            const data = snapshot.val();
            if (!data) throw new Error('Invalid credentials');

            const uid = Object.keys(data)[0];
            const student = data[uid];

            if (student.password !== password) throw new Error('Invalid credentials');
            if (student.status === 'disabled') throw new Error('Account is disabled. Contact manager.');

            this.currentUser = { uid, ...student };
            this.userRole = 'student';
            this.userData = student;

            localStorage.setItem('somstar_user', JSON.stringify({
                id: studentId,
                role: 'student',
                name: student.fullName,
                uid: uid
            }));

            return { success: true, role: 'student', data: student };
        } catch (e) {
            if (e.message === 'Invalid credentials') {
                try {
                    const teacherSnap = await db.ref('teachers').orderByChild('teacherId').equalTo(studentId).once('value');
                    const tData = teacherSnap.val();
                    if (!tData) throw new Error('Invalid credentials');
                    const tid = Object.keys(tData)[0];
                    const teacher = tData[tid];
                    if (teacher.password !== password) throw new Error('Invalid credentials');

                    this.currentUser = { uid: tid, ...teacher };
                    this.userRole = 'teacher';
                    this.userData = teacher;

                    localStorage.setItem('somstar_user', JSON.stringify({
                        id: studentId,
                        role: 'teacher',
                        name: teacher.name,
                        uid: tid
                    }));

                    return { success: true, role: 'teacher', data: teacher };
                } catch (e2) {
                    if (studentId === 'MANAGER' && password === '@som1234') {
                        this.currentUser = { uid: 'manager' };
                        this.userRole = 'manager';
                        this.userData = { name: 'Manager' };
                        localStorage.setItem('somstar_user', JSON.stringify({
                            id: 'MANAGER',
                            role: 'manager',
                            name: 'Manager',
                            uid: 'manager'
                        }));
                        return { success: true, role: 'manager', data: { name: 'Manager' } };
                    }
                    throw new Error('Invalid credentials');
                }
            }
            throw e;
        }
    },

    async loginWithFirebase(email, password, role) {
        try {
            const result = await auth.signInWithEmailAndPassword(email, password);
            const user = result.user;
            this.currentUser = { uid: user.uid };
            this.userRole = role;
            this.userData = { email: user.email, name: email.split('@')[0] };

            const idToken = result.user.uid;
            if (role === 'teacher') {
                await db.ref('teachers/' + user.uid).update({ lastLogin: new Date().toISOString() });
            }

            localStorage.setItem('somstar_user', JSON.stringify({
                id: email,
                role: role,
                name: email.split('@')[0],
                uid: user.uid
            }));

            return { success: true, role: role, data: this.userData };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    logout() {
        auth.signOut().catch(() => {});
        localStorage.removeItem('somstar_user');
        this.currentUser = null;
        this.userRole = null;
        this.userData = null;
        const isSubdir = window.location.pathname.includes('/manager/') || window.location.pathname.includes('/teacher/') || window.location.pathname.includes('/student/');
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
            default: window.location.href = 'login.html';
        }
    }
};
