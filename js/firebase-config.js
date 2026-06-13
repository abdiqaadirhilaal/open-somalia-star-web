const BACKEND_URL = window.location.origin + '/api/ref';

const AUTH_URL = window.location.origin + '/api';

let _initDone = false;

async function _init() {
    _initDone = true;
}

const _initPromise = _init();

function genKey() {
    return 'k' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
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

class MockSnapshot {
    constructor(data) { this._data = data; }
    val() { return this._data; }
    exists() { return this._data != null; }
}

class MockRef {
    constructor(path) { this.path = path; this._childKey = null; this._childVal = null; }
    async once(_eventType) {
        await _initPromise;
        const data = await _apiGet(this.path, this._childKey, this._childVal);
        return new MockSnapshot(data);
    }
    push(data) {
        return _initPromise.then(() => {
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
        });
    }
    async set(value) {
        await _initPromise;
        return _apiPut(this.path, value);
    }
    async update(obj) {
        await _initPromise;
        return _apiPatch(this.path, obj);
    }
    async remove() {
        await _initPromise;
        return _apiDelete(this.path);
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
        const data = await _apiGet(this.path, this._childKey, this._childVal);
        return new MockSnapshot(data);
    }
}

const db = {
    ref(path) { return new MockRef(path); },
    ready() { return _initPromise; }
};
