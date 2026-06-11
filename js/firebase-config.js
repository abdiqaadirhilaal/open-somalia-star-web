const STORE_KEY = 'somstar_db';

function getStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch(e) { return {}; }
}
function saveStore(store) {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function genKey() {
    return 'k' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function navigate(store, path) {
    const parts = path.split('/').filter(Boolean);
    let current = store;
    for (let i = 0; i < parts.length; i++) {
        if (current == null || typeof current !== 'object') return undefined;
        if (!(parts[i] in current)) return undefined;
        current = current[parts[i]];
    }
    return current;
}

function navigateOrCreate(store, path) {
    const parts = path.split('/').filter(Boolean);
    let current = store;
    for (let i = 0; i < parts.length; i++) {
        if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
            current[parts[i]] = {};
        }
        current = current[parts[i]];
    }
    return current;
}

function setPath(store, path, value) {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return;
    const key = parts.pop();
    const parent = navigateOrCreate(store, parts.join('/'));
    parent[key] = value;
}

function removePath(store, path) {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return;
    const key = parts.pop();
    const parent = navigate(store, parts.join('/'));
    if (parent && typeof parent === 'object') {
        delete parent[key];
    }
}

class MockSnapshot {
    constructor(data) { this._data = data; }
    val() { return this._data; }
    exists() { return this._data != null; }
}

class MockRef {
    constructor(path) { this.path = path; this._childKey = null; this._childVal = null; }
    once(_eventType) {
        const store = getStore();
        const data = navigate(store, this.path);
        if (this._childKey && this._childVal != null && data && typeof data === 'object') {
            const filtered = {};
            for (const k of Object.keys(data)) {
                if (data[k] && data[k][this._childKey] === this._childVal) {
                    filtered[k] = data[k];
                }
            }
            return Promise.resolve(new MockSnapshot(Object.keys(filtered).length ? filtered : null));
        }
        return Promise.resolve(new MockSnapshot(data !== undefined ? data : null));
    }
    push(data) {
        const key = genKey();
        const childPath = this.path + '/' + key;
        if (data !== undefined) {
            const store = getStore();
            const parent = navigateOrCreate(store, this.path);
            parent[key] = data;
            saveStore(store);
        }
        const ref = new MockRef(childPath);
        ref.key = key;
        return ref;
    }
    set(value) {
        const store = getStore();
        setPath(store, this.path, value);
        saveStore(store);
        return Promise.resolve();
    }
    update(obj) {
        const store = getStore();
        const target = navigateOrCreate(store, this.path);
        if (target && typeof target === 'object') {
            Object.assign(target, obj);
        }
        saveStore(store);
        return Promise.resolve();
    }
    remove() {
        const store = getStore();
        removePath(store, this.path);
        saveStore(store);
        return Promise.resolve();
    }
    orderByChild(child) {
        const q = new MockQuery(this.path);
        q._childKey = child;
        return q;
    }
}

class MockQuery {
    constructor(path) { this.path = path; this._childKey = null; this._childVal = null; }
    equalTo(value) {
        this._childVal = value;
        return this;
    }
    once(_eventType) {
        const store = getStore();
        const data = navigate(store, this.path);
        if (this._childKey && this._childVal != null && data && typeof data === 'object') {
            const filtered = {};
            for (const k of Object.keys(data)) {
                if (data[k] && data[k][this._childKey] === this._childVal) {
                    filtered[k] = data[k];
                }
            }
            return Promise.resolve(new MockSnapshot(Object.keys(filtered).length ? filtered : null));
        }
        return Promise.resolve(new MockSnapshot(data !== undefined ? data : null));
    }
}

const db = {
    ref(path) { return new MockRef(path); }
};

const auth = {
    _user: null,
    async signInWithEmailAndPassword(email, _password) {
        this._user = { uid: 'mock_' + genKey(), email };
        return { user: this._user };
    },
    async signOut() {
        this._user = null;
    },
    onAuthStateChanged() {}
};

const storage = {
    ref() { return { put() {}, getDownloadURL() {} }; }
};

const firestore = {
    collection(_name) {
        return {
            doc(_id) {
                return {
                    async get() { return { exists: false, data: () => null }; },
                    async set() {},
                    async update() {},
                    async delete() {}
                };
            }
        };
    }
};
