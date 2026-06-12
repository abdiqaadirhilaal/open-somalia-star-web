const STORE_KEY = 'somstar_db';
const DB_NAME = 'SOMSTAR_ACADEMY_DB';
const DB_VERSION = 1;

const BACKEND_URL = window.location.origin + '/api/ref';

// Server mode: when NOT file:// AND (port is 3000 OR hostname is a real domain)
const IS_SERVER = window.location.protocol !== 'file:' && 
    (window.location.port === '3000' || 
     (window.location.hostname !== '127.0.0.1' && window.location.hostname !== 'localhost'));

let _memoryStore = null;
let _initDone = false;

async function _openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('backup')) {
                db.createObjectStore('backup');
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function _loadFromIndexedDB() {
    try {
        const db = await _openDB();
        return new Promise((resolve) => {
            const tx = db.transaction('backup', 'readonly');
            const store = tx.objectStore('backup');
            const req = store.get(STORE_KEY);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch(e) { return null; }
}

async function _saveToIndexedDB(data) {
    try {
        const db = await _openDB();
        const tx = db.transaction('backup', 'readwrite');
        tx.objectStore('backup').put(data, STORE_KEY);
    } catch(e) {}
}

async function _init() {
    if (_initDone) return;
    if (IS_SERVER) {
        _memoryStore = {};
        _initDone = true;
        return;
    }
    const idbData = await _loadFromIndexedDB();
    if (idbData) {
        _memoryStore = idbData;
        try { localStorage.setItem(STORE_KEY, JSON.stringify(idbData)); } catch(e) {}
    } else {
        try {
            const local = localStorage.getItem(STORE_KEY);
            _memoryStore = local ? JSON.parse(local) : {};
        } catch(e) { _memoryStore = {}; }
    }
    _initDone = true;
}

const _initPromise = _init();

function getStore() {
    return _memoryStore || {};
}

function saveStore(store) {
    _memoryStore = store;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch(e) {}
    _saveToIndexedDB(store);
}

async function _apiGet(path, child, value) {
    let url = `${BACKEND_URL}/${path}`;
    if (child && value !== undefined) url += `?child=${encodeURIComponent(child)}&value=${encodeURIComponent(value)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API GET ${path} failed: ${res.status}`);
    return res.json();
}

async function _apiPost(path, data) {
    const res = await fetch(`${BACKEND_URL}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`API POST ${path} failed: ${res.status}`);
    return res.json();
}

async function _apiPut(path, value) {
    const res = await fetch(`${BACKEND_URL}/${path}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value)
    });
    if (!res.ok) throw new Error(`API PUT ${path} failed: ${res.status}`);
    return res.json();
}

async function _apiPatch(path, obj) {
    const res = await fetch(`${BACKEND_URL}/${path}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj)
    });
    if (!res.ok) throw new Error(`API PATCH ${path} failed: ${res.status}`);
    return res.json();
}

async function _apiDelete(path) {
    const res = await fetch(`${BACKEND_URL}/${path}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`API DELETE ${path} failed: ${res.status}`);
    return res.json();
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
    async once(_eventType) {
        await _initPromise;
        if (IS_SERVER) {
            const data = await _apiGet(this.path, this._childKey, this._childVal);
            return new MockSnapshot(data);
        }
        const store = getStore();
        const data = navigate(store, this.path);
        if (this._childKey && this._childVal != null && data && typeof data === 'object') {
            const filtered = {};
            for (const k of Object.keys(data)) {
                if (data[k] && data[k][this._childKey] === this._childVal) {
                    filtered[k] = data[k];
                }
            }
            return new MockSnapshot(Object.keys(filtered).length ? filtered : null);
        }
        return new MockSnapshot(data !== undefined ? data : null);
    }
    push(data) {
        return _initPromise.then(() => {
            if (IS_SERVER) {
                if (data !== undefined) {
                    return _apiPost(this.path, data).then(result => {
                        const ref = new MockRef(this.path + '/' + result.key);
                        ref.key = result.key;
                        return ref;
                    });
                }
                const tempKey = genKey();
                const ref = new MockRef(this.path + '/' + tempKey);
                ref.key = tempKey;
                return ref;
            }
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
        });
    }
    async set(value) {
        await _initPromise;
        if (IS_SERVER) { return _apiPut(this.path, value); }
        const store = getStore();
        setPath(store, this.path, value);
        saveStore(store);
    }
    async update(obj) {
        await _initPromise;
        if (IS_SERVER) { return _apiPatch(this.path, obj); }
        const store = getStore();
        const target = navigateOrCreate(store, this.path);
        if (target && typeof target === 'object') Object.assign(target, obj);
        saveStore(store);
    }
    async remove() {
        await _initPromise;
        if (IS_SERVER) { return _apiDelete(this.path); }
        const store = getStore();
        removePath(store, this.path);
        saveStore(store);
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
    async once(_eventType) {
        await _initPromise;
        if (IS_SERVER) {
            const data = await _apiGet(this.path, this._childKey, this._childVal);
            return new MockSnapshot(data);
        }
        const store = getStore();
        const data = navigate(store, this.path);
        if (this._childKey && this._childVal != null && data && typeof data === 'object') {
            const filtered = {};
            for (const k of Object.keys(data)) {
                if (data[k] && data[k][this._childKey] === this._childVal) {
                    filtered[k] = data[k];
                }
            }
            return new MockSnapshot(Object.keys(filtered).length ? filtered : null);
        }
        return new MockSnapshot(data !== undefined ? data : null);
    }
}

const db = {
    ref(path) { return new MockRef(path); },
    ready() { return _initPromise; }
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
