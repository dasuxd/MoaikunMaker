/* Optional development tool. Remove this file, its script tag and the small
 * ramRecorder hooks in NesEmulator to remove it. Never modifies cartridge RAM.
 * Counters describe JSNES's functional accesses, not cycle-exact bus activity.
 */
class RamRecordingStore {
    static DATABASE = 'MoaikunRamRecorderV1';
    static JOURNAL_PREFIX = 'moaikunRamJournalV1:';
    constructor(indexedDB, storage) {
        this.indexedDB = indexedDB;
        this.storage = storage;
        this.opening = null;
    }
    async open() {
        if (!this.opening) {
            this.opening = new Promise((resolve, reject) => {
                const request = this.indexedDB.open(RamRecordingStore.DATABASE, 1);
                request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'id' });
                request.onerror = () => reject(request.error);
                request.onblocked = () => reject(new Error('RAM database is blocked by another tab'));
                request.onsuccess = () => {
                    const db = request.result;
                    db.onversionchange = () => { db.close(); this.opening = null; };
                    resolve(db);
                };
            }).catch(error => { this.opening = null; throw error; });
        }
        return this.opening;
    }
    journal(snapshot) {
        // A synchronous recovery copy covers page closure before IDB commits.
        const key = RamRecordingStore.JOURNAL_PREFIX + snapshot.id;
        const previous = this.storage.getItem(key);
        if (!previous || JSON.parse(previous).revision <= snapshot.revision) {
            this.storage.setItem(key, JSON.stringify(snapshot));
        }
    }
    async put(snapshot) {
        const db = await this.open();
        await new Promise((resolve, reject) => {
            let tx;
            try { tx = db.transaction('sessions', 'readwrite', { durability: 'strict' }); }
            catch { tx = db.transaction('sessions', 'readwrite'); }
            const store = tx.objectStore('sessions');
            const request = store.get(snapshot.id);
            request.onsuccess = () => {
                // Recovery in another tab cannot overwrite a newer checkpoint.
                if (!request.result || request.result.revision < snapshot.revision) store.put(snapshot);
            };
            tx.oncomplete = resolve;
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('RAM checkpoint aborted'));
        });
        const key = RamRecordingStore.JOURNAL_PREFIX + snapshot.id;
        // Do not remove a newer journal written while this transaction ran.
        const journal = this.storage.getItem(key);
        if (journal && JSON.parse(journal).revision <= snapshot.revision) this.storage.removeItem(key);
    }
    async recover() {
        const snapshots = [];
        for (let i = 0; i < this.storage.length; i++) {
            const key = this.storage.key(i);
            if (key?.startsWith(RamRecordingStore.JOURNAL_PREFIX)) {
                snapshots.push(RamAccessTracker.validate(JSON.parse(this.storage.getItem(key))));
            }
        }
        for (const snapshot of snapshots) await this.put(snapshot);
    }
    async list() {
        await this.recover();
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sessions', 'readonly');
            const request = tx.objectStore('sessions').getAll();
            tx.oncomplete = () => resolve(request.result.map(value => RamAccessTracker.validate(value)));
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('RAM records could not be read'));
        });
    }
}

class RamAccessTracker {
    static SIZE = 0x800;
    static FIELDS = ['reads', 'writes', 'changes', 'loadingReads', 'loadingWrites', 'loadingChanges'];
    static SOURCE_LIMIT = 4;
    static makeId() {
        return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    }
    static reserved(address) {
        return (address >= 0x75 && address <= 0x7D) ||
            (address >= 0x100 && address < 0x400) || address >= 0x700 ||
            [0x2A, 0x9D, 0xC1, 0xC2, 0xC3, 0xC4, 0xC7, 0xC8, 0xFC, 0xFD, 0xFE, 0xFF].includes(address);
    }
    static category(counts, address) {
        if (RamAccessTracker.reserved(address)) return 'reserved';
        if (counts.reads[address] || counts.loadingReads[address]) return 'read';
        if (counts.writes[address]) return 'written';
        if (counts.loadingWrites[address]) return 'loading';
        return 'unseen';
    }
    static validate(value) {
        if (!value || value.version !== 1 || typeof value.id !== 'string' ||
            value.id.length > 160 || !/^[\w-]+$/.test(value.id) ||
            !Number.isSafeInteger(value.revision) || value.revision < 0 ||
            typeof value.romHash !== 'string' || !/^(?:[a-f0-9]{64}|unhashed:[\w-]+)$/.test(value.romHash) ||
            !['gameplay', 'boot'].includes(value.startMode) ||
            !Array.isArray(value.codes) || value.codes.length > 262144 ||
            value.codes.some(code => typeof code !== 'string' || code.length > 120) ||
            !Array.isArray(value.coverage) || value.coverage.some(entry => !Array.isArray(entry) ||
                entry.length !== 2 || typeof entry[0] !== 'string' || entry[0].length > 300 ||
                !Number.isSafeInteger(entry[1]) || entry[1] < 0) ||
            ['createdAt', 'updatedAt', 'romSize', 'frames', 'instructions', 'restores'].some(field =>
                !Number.isSafeInteger(value[field]) || value[field] < 0)) {
            throw new Error('Invalid RAM recording');
        }
        for (const field of RamAccessTracker.FIELDS) {
            if (!Array.isArray(value.counts?.[field]) || value.counts[field].length !== RamAccessTracker.SIZE ||
                value.counts[field].some(count => !Number.isSafeInteger(count) || count < 0)) throw new Error('Invalid RAM counters');
        }
        for (const field of ['readSources', 'writeSources']) {
            if (!Array.isArray(value[field]) || value[field].length !== RamAccessTracker.SIZE ||
                value[field].some(sources => sources !== null && (!Array.isArray(sources) ||
                    sources.length > RamAccessTracker.SOURCE_LIMIT || sources.some(index =>
                        !Number.isInteger(index) || index < 0 || index >= value.codes.length)))) throw new Error('Invalid RAM sources');
        }
        if (!Array.isArray(value.truncated) || value.truncated.length !== RamAccessTracker.SIZE ||
            value.truncated.some(flag => !Number.isInteger(flag) || flag < 0 || flag > 3)) throw new Error('Invalid RAM source flags');
        // Additive fields keep existing recordings/backups readable. Missing
        // values stay unknown rather than being silently interpreted as zero.
        if (value.lastValues !== undefined || value.lastValueTimes !== undefined) {
            if (!Array.isArray(value.lastValues) || value.lastValues.length !== RamAccessTracker.SIZE ||
                !Array.isArray(value.lastValueTimes) || value.lastValueTimes.length !== RamAccessTracker.SIZE ||
                value.lastValues.some((byte, address) => !Number.isInteger(byte) || byte < -1 || byte > 255 ||
                    !Number.isSafeInteger(value.lastValueTimes[address]) || value.lastValueTimes[address] < 0 ||
                    (byte === -1) !== (value.lastValueTimes[address] === 0))) throw new Error('Invalid RAM last values');
        }
        return value;
    }
    constructor(nes, metadata = {}) {
        this.nes = nes;
        this.metadata = { id: RamAccessTracker.makeId(), romHash: 'pending', romSize: 0,
            createdAt: Date.now(), startMode: 'gameplay', ...metadata };
        // A page can close before Web Crypto completes. Such checkpoints keep
        // a unique identity and remain recoverable without waiting for hashing.
        if (this.metadata.romHash === 'pending') this.metadata.romHash = `unhashed:${this.metadata.id}`;
        this.counts = Object.fromEntries(RamAccessTracker.FIELDS.map(field => [field, new Float64Array(RamAccessTracker.SIZE)]));
        this.lastValues = new Int16Array(RamAccessTracker.SIZE).fill(-1);
        this.lastValueTimes = new Float64Array(RamAccessTracker.SIZE);
        this.frameTime = 0;
        this.instructionTime = 0;
        this.readSources = Array(RamAccessTracker.SIZE).fill(null);
        this.writeSources = Array(RamAccessTracker.SIZE).fill(null);
        this.truncated = new Uint8Array(RamAccessTracker.SIZE);
        this.codes = [];
        this.codeIndexes = new Map();
        this.coverage = new Map();
        this.revision = 0;
        this.savedRevision = -1;
        this.instructions = 0;
        this.frames = 0;
        this.restores = 0;
        this.started = false;
        this.executing = false;
        this.hooks = [];
        this.currentCode = 0;
        this.attached = false;
    }
    hook(object, name, wrapper) {
        const descriptor = Object.getOwnPropertyDescriptor(object, name);
        const original = object[name];
        const replacement = wrapper(original);
        object[name] = replacement;
        this.hooks.push(() => {
            if (object[name] !== replacement) return;
            if (descriptor) Object.defineProperty(object, name, descriptor);
            else delete object[name];
        });
    }
    findBanks() {
        this.banks = new Map();
        // JSNES saves the mapped PRG bytes in cpu.mem. Identify the actual bank
        // after a state restore, rather than assuming bank 0 is still mapped.
        for (const base of [0x8000, 0xC000]) {
            const bank = this.nes.rom.rom.findIndex(bytes => bytes.every((byte, i) => byte === this.rawMemory[base + i]));
            this.banks.set(base, bank);
        }
    }
    source(pc, kind = 'CPU') {
        const bank = pc >= 0xC000 ? this.banks.get(0xC000) : pc >= 0x8000 ? this.banks.get(0x8000) : -2;
        const key = (this.started ? 0x100000000 : 0) + (kind === 'interrupt' ? 0x80000000 : 0) + (bank + 2) * 0x10000 + pc;
        let index = this.codeIndexes.get(key);
        if (index === undefined) {
            index = this.codes.length;
            this.codes.push(`${this.started ? 'game' : 'loading'} ${kind} B${bank === -2 ? 'RAM' : bank} $${pc.toString(16).toUpperCase().padStart(4, '0')}`);
            this.codeIndexes.set(key, index);
        }
        this.currentCode = index;
    }
    access(address, write, changed, value) {
        if (this.currentCode < 0) this.source(this.instructionPc, this.instructionKind);
        const prefix = this.started ? '' : 'loading';
        const field = prefix ? (write ? 'loadingWrites' : 'loadingReads') : (write ? 'writes' : 'reads');
        this.counts[field][address] = Math.min(Number.MAX_SAFE_INTEGER, this.counts[field][address] + 1);
        this.lastValues[address] = value & 0xFF;
        // One clock read per frame, or lazily per standalone instruction. No
        // storage, DOM work or per-access clock call on the emulation hot path.
        this.lastValueTimes[address] = this.frameTime || (this.instructionTime ||= Date.now());
        if (write && changed) {
            const changes = prefix ? 'loadingChanges' : 'changes';
            this.counts[changes][address] = Math.min(Number.MAX_SAFE_INTEGER, this.counts[changes][address] + 1);
        }
        const list = write ? this.writeSources : this.readSources;
        const sources = list[address] ||= [];
        if (!sources.includes(this.currentCode)) {
            if (sources.length < RamAccessTracker.SOURCE_LIMIT) sources.push(this.currentCode);
            else this.truncated[address] |= write ? 2 : 1;
        }
        this.revision++;
    }
    attach() {
        if (this.attached) return;
        const tracker = this;
        const cpu = this.nes.cpu;
        this.rawMemory = cpu.mem;
        this.findBanks();
        this.proxy = new Proxy(this.rawMemory, {
            get(target, property) {
                if (tracker.executing && typeof property === 'string') {
                    const address = Number(property);
                    if (Number.isInteger(address) && address >= 0 && address < 0x10000) {
                        // Capture the PC at opcode fetch, after JSNES dispatches
                        // an interrupt and before it advances past operands.
                        if (!tracker.fetched && address === ((cpu.REG_PC + 1) & 0xFFFF)) {
                            tracker.fetched = true;
                            tracker.instructionPc = address;
                            tracker.instructionKind = 'CPU';
                            tracker.currentCode = -1;
                        }
                        if (address < 0x2000) tracker.access(address & 0x7FF, false, false, target[property]);
                    }
                }
                return target[property];
            },
            set(target, property, value) {
                if (tracker.executing && typeof property === 'string') {
                    const address = Number(property);
                    if (Number.isInteger(address) && address >= 0 && address < 0x2000) {
                        tracker.access(address & 0x7FF, true, target[property] !== value, value);
                    }
                }
                target[property] = value;
                return true;
            }
        });
        cpu.mem = this.proxy;
        // All actual RAM paths use cpu.mem, including load16bit, indirect JMP,
        // stack operations and OAM DMA. Host reads/saves are not game accesses.
        this.hook(cpu, 'emulate', original => function (...args) {
            if (!tracker.started && tracker.rawMemory[0x18] === 4 &&
                tracker.rawMemory[0x30] === 12 && tracker.rawMemory[0x56] === 3) tracker.started = true;
            tracker.executing = true;
            tracker.instructionTime = 0;
            tracker.fetched = false;
            tracker.instructionPc = (cpu.REG_PC + 1) & 0xFFFF;
            tracker.instructionKind = cpu.irqRequested ? 'interrupt' : 'CPU';
            tracker.currentCode = -1;
            try { return original.apply(this, args); }
            finally { tracker.executing = false; tracker.instructions++; }
        });
        this.hook(this.nes.mmap, 'loadRomBank', original => function (bank, base) {
            tracker.banks.set(base, bank % tracker.nes.rom.romCount);
            return original.call(this, bank, base);
        });
        this.hook(this.nes, 'frame', original => function (...args) {
            tracker.frameTime = Date.now();
            try { return original.apply(this, args); }
            finally {
                tracker.frameTime = 0;
                tracker.frames++;
                const m = tracker.rawMemory;
                const key = `${tracker.started ? 'game' : 'loading'} level=${m[0x3C]} scene=${m[0x3E]} wide=${m[0x3D] & 1} state=${m[0x18]}/${m[0x30]}/${m[0x56]} pause=${m[0x32]} view=${m[0x2A] & 1}`;
                tracker.coverage.set(key, (tracker.coverage.get(key) || 0) + 1);
                tracker.revision++;
            }
        });
        this.attached = true;
    }
    detach() {
        if (!this.attached) return;
        this.executing = false;
        for (const restore of this.hooks.reverse()) restore();
        this.hooks = [];
        if (this.nes.cpu.mem === this.proxy) this.nes.cpu.mem = this.rawMemory;
        this.attached = false;
    }
    suspend(callback, restore = false) {
        const attached = this.attached;
        this.detach();
        try { return callback(); }
        finally {
            if (restore) { this.restores++; this.revision++; }
            if (attached) this.attach();
        }
    }
    snapshot() {
        return { version: 1, ...this.metadata, revision: this.revision, updatedAt: Date.now(),
            instructions: this.instructions, frames: this.frames, restores: this.restores, started: this.started,
            counts: Object.fromEntries(RamAccessTracker.FIELDS.map(field => [field, Array.from(this.counts[field])])),
            lastValues: Array.from(this.lastValues), lastValueTimes: Array.from(this.lastValueTimes),
            readSources: this.readSources.map(list => list && [...list]),
            writeSources: this.writeSources.map(list => list && [...list]),
            truncated: Array.from(this.truncated), codes: [...this.codes], coverage: [...this.coverage] };
    }
}

class RamRecorder {
    static instance = null;
    static SETTINGS_KEY = 'moaikunRamRecorderSettingsV1';
    static FILTERS_KEY = 'moaikunRamMapFiltersV1';
    static MAP_COLORS = { unseen:'#e2e8f0', loading:'#fbbf24', written:'#a78bfa', read:'#38bdf8', reserved:'#475569' };
    static normalizeFilters(value) {
        return Object.fromEntries(Object.keys(this.MAP_COLORS).map(key => [key, typeof value?.[key] === 'boolean' ? value[key] : true]));
    }
    static getInstance() { return this.instance ||= new RamRecorder(); }
    constructor(options = {}) {
        let storageError = null;
        try { this.storage = options.storage || globalThis.localStorage; }
        catch (error) { storageError = error; }
        // An optional tool must not break ROM loading when browser storage is
        // denied. Attempts to enable/save still report the failure explicitly.
        this.storage ||= { length:0, key:() => null, getItem:() => null,
            setItem:() => { throw new Error('Browser storage is unavailable'); }, removeItem() {} };
        let indexedDB;
        try { indexedDB = options.indexedDB || globalThis.indexedDB; }
        catch (error) { storageError ||= error; }
        this.store = options.store || new RamRecordingStore(indexedDB, this.storage);
        this.crypto = options.crypto || globalThis.crypto;
        this.settings = { enabled: false, startMode: 'gameplay' };
        this.mapFilters = RamRecorder.normalizeFilters(null);
        this.trackers = new Set();
        this.tracker = null;
        this.emulator = null;
        this.timer = null;
        this.lastSaved = null;
        this.error = storageError ? String(storageError.message || storageError) : '';
        this.pending = new Set();
        this.ui = null;
        try {
            const saved = JSON.parse(this.storage.getItem(RamRecorder.SETTINGS_KEY) || 'null');
            if (saved) this.settings = { enabled: saved.enabled === true, startMode: saved.startMode === 'boot' ? 'boot' : 'gameplay' };
            this.mapFilters = RamRecorder.normalizeFilters(JSON.parse(this.storage.getItem(RamRecorder.FILTERS_KEY) || 'null'));
        } catch (error) { this.error = String(error.message || error); }
        if (this.settings.enabled) this.beginTimer();
    }
    async hash(bytes, id) {
        if (!this.crypto?.subtle) return `unhashed:${id}`; // Never merge uncertain identities.
        const digest = await this.crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    beginTimer() {
        if (!this.timer) this.timer = setInterval(() => { this.flush(); this.renderStatus(); }, 3000);
        this.timer?.unref?.();
    }
    load(emulator, bytes) {
        this.stop();
        this.emulator = emulator;
        this.romBytes = Uint8Array.from(bytes);
        if (this.settings.enabled) this.beginRecording();
        this.renderStatus();
    }
    beginRecording() {
        if (!this.emulator?.nes?.mmap || this.tracker) return;
        const config = typeof app !== 'undefined' ? app.romEditor?.getGameConfig?.() : null;
        const tracker = new RamAccessTracker(this.emulator.nes, { romSize: this.romBytes.length,
            startMode: this.settings.startMode, gameConfig: config && { ...config } });
        // "boot" counts all accesses in the main columns; gameplay mode keeps
        // pre-game accesses in separate columns, never silently discarding them.
        tracker.started = this.settings.startMode === 'boot';
        this.tracker = tracker;
        this.trackers.add(tracker);
        tracker.attach();
        tracker.ready = this.hash(this.romBytes, tracker.metadata.id)
            .catch(() => `unhashed:${tracker.metadata.id}`).then(hash => {
                tracker.metadata.romHash = hash;
                tracker.revision++;
                this.trackers.add(tracker);
                return this.persist(tracker);
            }).catch(error => { this.fail(error); });
        this.beginTimer();
    }
    stop() {
        this.tracker?.detach();
        this.flush();
        this.tracker = null;
        this.renderStatus();
    }
    resumeRecording() {
        if (this.settings.enabled) {
            if (!this.tracker) this.beginRecording();
            else this.tracker.attach();
        }
    }
    suspend(callback, restore = false) {
        return this.tracker ? this.tracker.suspend(callback, restore) : callback();
    }
    fail(error) {
        this.error = String(error?.message || error);
        this.renderStatus();
    }
    setEnabled(enabled, persistPreference = true) {
        const settings = { ...this.settings, enabled };
        // A failed preference write does not claim the switch was remembered.
        try { if (persistPreference) this.storage.setItem(RamRecorder.SETTINGS_KEY, JSON.stringify(settings)); }
        catch (error) { this.fail(error); this.renderStatus(); return false; }
        this.settings = settings;
        if (enabled) {
            this.error = '';
            this.beginRecording();
            this.beginTimer();
            this.store.recover().catch(error => this.fail(error));
            globalThis.navigator?.storage?.persist?.().catch(() => {});
        } else {
            this.stop();
            clearInterval(this.timer);
            this.timer = null;
        }
        this.renderStatus();
        return true;
    }
    setStartMode(startMode, persistPreference = true) {
        try {
            if (persistPreference) this.storage.setItem(RamRecorder.SETTINGS_KEY, JSON.stringify({ ...this.settings, startMode }));
            this.settings.startMode = startMode;
        } catch (error) { this.fail(error); }
        this.renderStatus();
    }
    persist(tracker) {
        if (tracker.revision === tracker.savedRevision) return Promise.resolve();
        const snapshot = tracker.snapshot();
        try { this.store.journal(snapshot); } catch (error) { this.fail(error); }
        const pending = this.store.put(snapshot).then(() => {
            tracker.savedRevision = Math.max(tracker.savedRevision, snapshot.revision);
            this.lastSaved = snapshot.updatedAt;
            this.error = '';
            if (tracker !== this.tracker && !tracker.attached && tracker.revision === tracker.savedRevision) this.trackers.delete(tracker);
        }).catch(error => { this.fail(error); }).finally(() => { this.pending.delete(pending); this.renderStatus(); });
        this.pending.add(pending);
        return pending;
    }
    flush() {
        return Promise.all([...this.trackers].map(tracker => this.persist(tracker)));
    }
    async records() {
        await Promise.all([...this.trackers].map(tracker => tracker.ready));
        await this.flush();
        await Promise.all([...this.pending]);
        const sessions = await this.store.list();
        const merged = new Map(sessions.map(session => [session.id, session]));
        for (const tracker of this.trackers) merged.set(tracker.metadata.id, tracker.snapshot());
        return [...merged.values()];
    }
    static aggregate(records) {
        const counts = Object.fromEntries(RamAccessTracker.FIELDS.map(field => [field, new Float64Array(RamAccessTracker.SIZE)]));
        for (const record of records) for (const field of RamAccessTracker.FIELDS) {
            for (let address = 0; address < RamAccessTracker.SIZE; address++) {
                counts[field][address] = Math.min(Number.MAX_SAFE_INTEGER, counts[field][address] + record.counts[field][address]);
            }
        }
        return counts;
    }
    static latestValues(records) {
        const values = new Int16Array(RamAccessTracker.SIZE).fill(-1);
        const times = new Float64Array(RamAccessTracker.SIZE);
        const sources = Array(RamAccessTracker.SIZE).fill(null);
        // Tie-break consistently across tabs/import order. Each address uses
        // its observation time, never the session's later checkpoint time.
        const ordered = [...records].sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
        for (const record of ordered) {
            if (!record.lastValues) continue;
            for (let address = 0; address < RamAccessTracker.SIZE; address++) {
                if (record.lastValues[address] < 0 || record.lastValueTimes[address] < times[address]) continue;
                values[address] = record.lastValues[address];
                times[address] = record.lastValueTimes[address];
                sources[address] = record;
            }
        }
        return { values, times, sources };
    }
    text(key) {
        const language = typeof i18n !== 'undefined' ? i18n.currentLang : 'zh-CN';
        return (RamRecorder.TEXT[language] || RamRecorder.TEXT['en-US'])[key];
    }
    setMapFilters(value, persist = true) {
        const filters = RamRecorder.normalizeFilters(value);
        try {
            if (persist) this.storage.setItem(RamRecorder.FILTERS_KEY, JSON.stringify(filters));
            this.mapFilters = filters;
        } catch (error) { this.fail(error); }
        this.renderMap();
    }
    reservationReason(address) {
        if (address >= 0x75 && address <= 0x7C) return this.text('enemyBirthReason');
        if (address === 0x7D) return this.text('playerYReason');
        if (address >= 0x100 && address < 0x200) return this.text('stackReason');
        if (address >= 0x200 && address < 0x400) return this.text('bufferReason');
        if (address >= 0x700 && address < 0x800) return this.text('mapReason');
        return RamAccessTracker.reserved(address) ? this.text('variableReason') : this.text('notReserved');
    }
    mount(document) {
        if (this.ui || !document.getElementById('gameConfigPanel')) return;
        const style = document.createElement('style');
        style.id = 'ramRecorderStyles';
        style.textContent = `
            #ramRecorderControls { margin-top:12px; border-top:1px solid #cbd5e1; padding-top:10px; }
            #ramRecorderControls label { display:flex; gap:8px; align-items:center; }
            #ramRecorderControls p { font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
            #ramRecorderControls select { max-width:100%; margin:6px 0; }
            #ramRecorderDialog { width:min(1000px,94vw); max-height:90vh; margin:auto; box-sizing:border-box; border:1px solid #94a3b8; border-radius:10px; padding:16px; color:#1e293b; background:#fff; }
            #ramRecorderDialog::backdrop { background:#0008; }
            #ramRecorderDialog .ram-actions { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0; }
            #ramRecorderDialog p { font-size:13px; line-height:1.5; }
            #ramRecorderDialog .ram-memory { display:grid; grid-template-columns:minmax(0,2fr) minmax(0,1fr); gap:14px; align-items:start; }
            #ramRecorderDialog .ram-map-scroll { max-height:42vh; overflow:auto; border:1px solid #94a3b8; }
            #ramRecordingMap { display:grid; grid-template-columns:58px repeat(16,minmax(26px,1fr)); min-width:490px; font:12px/1.4 monospace; background:#cbd5e1; gap:1px; }
            #ramRecordingMap .ram-map-heading { position:sticky; top:0; z-index:2; background:#f1f5f9; padding:5px 0; text-align:center; color:#334155; }
            #ramRecordingMap .ram-map-heading:first-child { left:0; z-index:3; }
            #ramRecordingMap .ram-map-address { position:sticky; left:0; z-index:1; background:#f1f5f9; padding:5px 3px; color:#334155; }
            #ramRecordingMap .ram-byte { padding:4px 0; min-width:0; min-height:28px; border:0; border-radius:0; font:inherit; cursor:pointer; transition:none; scroll-margin-top:29px; }
            #ramRecordingMap .ram-byte[aria-pressed="true"] { outline:2px solid #e11d48; outline-offset:-2px; }
            #ramRecordingMap .ram-byte:focus-visible { outline:2px solid #2563eb; outline-offset:-2px; }
            #ramRecorderDialog pre { margin:0; max-height:42vh; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font-size:12px; line-height:1.6; }
            @media(max-width:760px) { #ramRecorderDialog .ram-memory { grid-template-columns:minmax(0,1fr); } #ramRecorderDialog .ram-map-scroll { max-height:32vh; } #ramRecorderDialog pre { max-height:24vh; } }
            #ramRecorderDialog .ram-error, #ramRecorderControls .ram-error { color:#b91c1c; }
            #ramRecorderDialog button, #ramRecorderControls button { padding:6px 10px; cursor:pointer; }
            #ramRecorderDialog select { max-width:100%; }
            #ramRecorderDialog .ram-map-filters { border:1px solid #cbd5e1; padding:8px; margin:8px 0; }
            #ramRecorderDialog .ram-filter-options { display:flex; flex-wrap:wrap; gap:8px 14px; margin:6px 0; }
            #ramRecorderDialog .ram-filter { display:inline-flex; align-items:center; gap:5px; cursor:pointer; font-size:13px; }
            #ramRecorderDialog .ram-swatch { width:12px; height:12px; border:1px solid #64748b; display:inline-block; }
            #ramRecorderDialog details { margin:8px 0; font-size:13px; }
            #ramRecorderDialog summary { cursor:pointer; }
            #ramRecorderDialog .ram-map-filters p { margin:5px 0; }
        `;
        document.head.append(style);
        const controls = document.createElement('div');
        controls.id = 'ramRecorderControls';
        controls.innerHTML = `<label><input id="ramRecordingEnabled" type="checkbox"><span></span></label>
            <select id="ramRecordingMode"><option value="gameplay"></option><option value="boot"></option></select>
            <p id="ramRecordingStatus" role="status"></p><p id="ramRecordingHint"></p>
            <button id="ramRecordingView" type="button"></button>`;
        document.getElementById('gameConfigPanel').append(controls);
        const dialog = document.createElement('dialog');
        dialog.id = 'ramRecorderDialog';
        dialog.setAttribute('aria-labelledby', 'ramRecorderTitle');
        dialog.innerHTML = `<h2 id="ramRecorderTitle"></h2><p id="ramRecorderExplanation"></p>
            <div class="ram-actions"><select id="ramRecordingGroup"></select>
            <button id="ramRecordingRefresh" type="button"></button><button id="ramRecordingExport" type="button"></button>
            <button id="ramRecordingImport" type="button"></button><input id="ramRecordingImportFile" type="file" accept="application/json,.json" hidden>
            <button id="ramRecordingClose" type="button"></button></div>
            <p id="ramRecordingSummary"></p><p id="ramRecordingEmptyNote" hidden></p>
            <fieldset class="ram-map-filters"><legend id="ramMapFilterTitle"></legend>
                <div class="ram-filter-options" id="ramMapFilterOptions"></div>
                <div class="ram-actions"><button id="ramMapCandidatesOnly" type="button"></button><button id="ramMapShowAll" type="button"></button></div>
                <p id="ramMapFilterHint"></p></fieldset>
            <details><summary id="ramRecordingMeaningTitle"></summary><div id="ramRecordingMeanings"></div><p id="ramRecordingValueHint"></p></details>
            <p id="ramRecordingLegend"></p>
            <div class="ram-memory"><div class="ram-map-scroll"><div id="ramRecordingMap" role="group" aria-label="RAM $0000–$07FF"></div></div>
            <pre id="ramRecordingDetail" aria-live="polite"></pre></div><p id="ramRecordingResult" role="status"></p>`;
        document.body.append(dialog);
        const get = id => document.getElementById(id);
        this.ui = { document, controls, dialog, get, records: [], selected: 'all', address: 0, cells:[] };
        const grid = document.createDocumentFragment();
        for (const label of ['$', ...Array.from({length:16}, (_,i) => i.toString(16).toUpperCase())]) {
            const heading = document.createElement('span'); heading.className = 'ram-map-heading'; heading.textContent = label; grid.append(heading);
        }
        for (let row = 0; row < 128; row++) {
            const heading = document.createElement('span'); heading.className = 'ram-map-address';
            heading.textContent = `$${(row * 16).toString(16).toUpperCase().padStart(4,'0')}`; grid.append(heading);
            for (let column = 0; column < 16; column++) {
                const address = row * 16 + column;
                const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'ram-byte';
                cell.dataset.address = address; cell.textContent = '--'; cell.tabIndex = address === 0 ? 0 : -1;
                cell.setAttribute('aria-pressed', String(address === 0));
                this.ui.cells.push(cell); grid.append(cell);
            }
        }
        get('ramRecordingMap').append(grid);
        for (const [category, color] of Object.entries(RamRecorder.MAP_COLORS)) {
            const label = document.createElement('label'); label.className = 'ram-filter';
            const input = document.createElement('input'); input.type = 'checkbox'; input.id = `ramMapFilter-${category}`;
            input.checked = this.mapFilters[category];
            const swatch = document.createElement('span'); swatch.className = 'ram-swatch'; swatch.style.background = color; swatch.setAttribute('aria-hidden','true');
            const name = document.createElement('span'); name.id = `ramMapFilterLabel-${category}`;
            label.append(input, swatch, name); get('ramMapFilterOptions').append(label);
            input.addEventListener('change', () => this.setMapFilters({ ...this.mapFilters, [category]:input.checked }));
        }
        get('ramMapCandidatesOnly').addEventListener('click', () => this.setMapFilters({ unseen:true, loading:true, written:false, read:false, reserved:false }));
        get('ramMapShowAll').addEventListener('click', () => this.setMapFilters(null));
        get('ramRecordingEnabled').addEventListener('change', event => this.setEnabled(event.target.checked));
        get('ramRecordingMode').addEventListener('change', event => this.setStartMode(event.target.value));
        get('ramRecordingView').addEventListener('click', () => this.openView());
        get('ramRecordingClose').addEventListener('click', () => dialog.close());
        get('ramRecordingRefresh').addEventListener('click', () => this.refreshView());
        get('ramRecordingGroup').addEventListener('change', event => { this.ui.selected = event.target.value; this.renderView(); });
        get('ramRecordingExport').addEventListener('click', () => this.exportRecords());
        get('ramRecordingImport').addEventListener('click', () => get('ramRecordingImportFile').click());
        get('ramRecordingImportFile').addEventListener('change', event => this.importRecords(event.target.files[0]).finally(() => { event.target.value = ''; }));
        get('ramRecordingMap').addEventListener('click', event => {
            const cell = event.target.closest('.ram-byte');
            if (cell) this.selectAddress(Number(cell.dataset.address));
        });
        get('ramRecordingMap').addEventListener('keydown', event => {
            if (!event.target.matches('.ram-byte')) return;
            const address = Number(event.target.dataset.address);
            const targets = { ArrowLeft:address-1, ArrowRight:address+1, ArrowUp:address-16, ArrowDown:address+16,
                PageUp:address-256, PageDown:address+256, Home:event.ctrlKey ? 0 : address & ~15, End:event.ctrlKey ? 2047 : address | 15 };
            if (targets[event.key] === undefined) return;
            event.preventDefault();
            this.selectAddress(Math.max(0, Math.min(2047, targets[event.key])), true);
        });
        dialog.addEventListener('keydown', event => event.stopPropagation());
        dialog.addEventListener('keyup', event => event.stopPropagation());
        dialog.addEventListener('close', () => {
            const paused = this.ui.paused;
            if (paused && paused.emulator.runGeneration === paused.generation && paused.emulator.isRunning) paused.emulator.resume();
            this.ui.paused = null;
        });
        new MutationObserver(() => {
            this.renderStatus();
            if (dialog.open) this.renderView();
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
        window.addEventListener('pagehide', () => this.flush());
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(); });
        window.addEventListener('storage', event => {
            if (event.key === RamRecorder.FILTERS_KEY) {
                try { this.setMapFilters(JSON.parse(event.newValue || 'null'), false); }
                catch (error) { this.fail(error); }
                return;
            }
            if (event.key !== RamRecorder.SETTINGS_KEY || !event.newValue) return;
            try {
                const settings = JSON.parse(event.newValue);
                // Do not echo storage events back to another tab: intermediate
                // preference writes could otherwise repeatedly re-enable it.
                this.setStartMode(settings.startMode === 'boot' ? 'boot' : 'gameplay', false);
                this.setEnabled(settings.enabled === true, false);
            } catch (error) { this.fail(error); }
        });
        this.renderStatus();
        // Recover committed/unfinished records without starting CPU observation.
        this.store.recover().catch(error => this.fail(error));
    }
    renderStatus() {
        if (!this.ui) return;
        const { get, controls } = this.ui;
        get('ramRecordingEnabled').checked = this.settings.enabled;
        controls.querySelector('label span').textContent = this.text('enabled');
        get('ramRecordingMode').value = this.settings.startMode;
        get('ramRecordingMode').options[0].textContent = this.text('gameplay');
        get('ramRecordingMode').options[1].textContent = this.text('boot');
        get('ramRecordingHint').textContent = this.text('hint');
        get('ramRecordingView').textContent = this.text('view');
        const status = get('ramRecordingStatus');
        status.classList.toggle('ram-error', Boolean(this.error));
        status.textContent = this.error ? `${this.text('error')}: ${this.error}` :
            `${this.text(this.settings.enabled ? (this.tracker?.attached ? (this.tracker.started ? 'recording' : 'waiting') : 'armed') : 'off')}${this.lastSaved ? ` · ${this.text('saved')} ${new Date(this.lastSaved).toLocaleTimeString()}` : ''}`;
        if (this.ui.dialog.open) this.translateView();
    }
    translateView() {
        const { get } = this.ui;
        for (const [id, key] of [['ramRecorderTitle','title'], ['ramRecorderExplanation','explanation'],
            ['ramRecordingRefresh','refresh'], ['ramRecordingExport','export'], ['ramRecordingImport','import'],
            ['ramRecordingClose','close'], ['ramRecordingLegend','legend'], ['ramMapFilterTitle','mapFilterTitle'],
            ['ramMapCandidatesOnly','candidatesOnly'], ['ramMapShowAll','showAll'], ['ramMapFilterHint','filterHint'],
            ['ramRecordingMeaningTitle','meaningTitle'], ['ramRecordingEmptyNote','emptyNote'], ['ramRecordingValueHint','valueHint']]) get(id).textContent = this.text(key);
        get('ramRecordingMeanings').replaceChildren();
        for (const category of Object.keys(RamRecorder.MAP_COLORS)) {
            const p = this.ui.document.createElement('p');
            p.textContent = `${this.text(category)}：${this.text(`${category}Meaning`)}`;
            get('ramRecordingMeanings').append(p);
        }
    }
    async openView() {
        const emulator = this.emulator;
        if (emulator?.isRunning && !emulator.isPaused) {
            this.ui.paused = { emulator, generation: emulator.runGeneration };
            emulator.pause();
        }
        this.ui.dialog.showModal();
        this.translateView();
        await this.refreshView();
    }
    async refreshView() {
        try {
            this.ui.records = await this.records();
            this.ui.get('ramRecordingResult').textContent = '';
            this.renderView();
        } catch (error) { this.fail(error); this.ui.get('ramRecordingResult').textContent = `${this.text('error')}: ${error.message}`; }
    }
    renderView() {
        const { get, document, records, selected } = this.ui;
        const groups = new Map();
        for (const record of records) groups.set(record.romHash, record);
        get('ramRecordingGroup').replaceChildren();
        for (const [value, label] of [['all', this.text('all')], ...[...groups].map(([hash, record]) =>
            [hash, `${hash.slice(0, 12)} · ${Math.round(record.romSize / 1024)} KiB · ${new Date(record.createdAt).toLocaleDateString()}`])]) {
            const option = document.createElement('option'); option.value = value; option.textContent = label; get('ramRecordingGroup').append(option);
        }
        this.ui.selected = groups.has(selected) ? selected : 'all';
        get('ramRecordingGroup').value = this.ui.selected;
        this.ui.filtered = records.filter(record => this.ui.selected === 'all' || record.romHash === this.ui.selected);
        this.ui.counts = RamRecorder.aggregate(this.ui.filtered);
        this.ui.latest = RamRecorder.latestValues(this.ui.filtered);
        this.renderMap();
        this.renderDetail();
    }
    renderMap() {
        if (!this.ui?.counts) return;
        const { get, counts, filtered } = this.ui;
        const totals = Object.fromEntries(Object.keys(RamRecorder.MAP_COLORS).map(key => [key,0]));
        for (let address = 0; address < RamAccessTracker.SIZE; address++) {
            const category = RamAccessTracker.category(counts,address);
            totals[category]++;
            const cell = this.ui.cells[address];
            const byte = this.ui.latest.values[address];
            const label = byte < 0 ? '--' : byte.toString(16).toUpperCase().padStart(2,'0');
            cell.textContent = label;
            cell.style.backgroundColor = this.mapFilters[category] ? RamRecorder.MAP_COLORS[category] : '#000000';
            cell.style.color = this.mapFilters[category] ? (category === 'reserved' ? '#ffffff' : '#0f172a') : '#94a3b8';
            cell.title = `$${address.toString(16).toUpperCase().padStart(4,'0')} · ${this.text(category)} · ${this.text('lastValue')}: ${label}`;
            cell.setAttribute('aria-label', cell.title);
        }
        for (const category of Object.keys(totals)) {
            get(`ramMapFilter-${category}`).checked = this.mapFilters[category];
            get(`ramMapFilterLabel-${category}`).textContent = `${this.text(category)} (${totals[category]})`;
            get(`ramMapFilter-${category}`).parentElement.title = this.text(`${category}Meaning`);
        }
        get('ramRecordingSummary').textContent = `${filtered.length} ${this.text('sessions')} · ${totals.unseen + totals.loading} ${this.text('candidates')} (${this.text('unseenCount')} ${totals.unseen} + ${this.text('loadingCount')} ${totals.loading}) · ${filtered.reduce((n,r) => n+r.frames,0).toLocaleString()} ${this.text('frames')}`;
        get('ramRecordingEmptyNote').hidden = filtered.some(record => record.instructions > 0);
    }
    selectAddress(address, focus = false) {
        const previous = this.ui.cells[this.ui.address], cell = this.ui.cells[address];
        previous.setAttribute('aria-pressed','false'); previous.tabIndex = -1;
        this.ui.address = address;
        cell.setAttribute('aria-pressed','true'); cell.tabIndex = 0;
        if (focus) { cell.focus({preventScroll:true}); cell.scrollIntoView({block:'nearest', inline:'nearest'}); }
        this.renderDetail();
    }
    renderDetail() {
        if (!this.ui?.counts) return;
        const { filtered = [], address, get } = this.ui;
        const reads = new Set(), writes = new Set(), coverage = new Set();
        let truncated = false;
        for (const record of filtered) {
            for (const index of record.readSources[address] || []) reads.add(record.codes[index]);
            for (const index of record.writeSources[address] || []) writes.add(record.codes[index]);
            for (const [key] of record.coverage) coverage.add(key);
            truncated ||= Boolean(record.truncated[address]);
        }
        const category = RamAccessTracker.category(this.ui.counts,address);
        const statistics = RamAccessTracker.FIELDS.map(field => `${this.text(field)}: ${this.ui.counts[field][address].toLocaleString()}`).join(' · ');
        const { values, times, sources } = this.ui.latest;
        const source = sources[address];
        const value = values[address] < 0 ? this.text('unknownValue') :
            `$${values[address].toString(16).toUpperCase().padStart(2,'0')} (${values[address]})\n${this.text('observedAt')}: ${new Date(times[address]).toLocaleString()}\n${this.text('valueSource')}: ${source.romHash.slice(0,12)} · ${source.id}`;
        get('ramRecordingDetail').textContent = `$${address.toString(16).toUpperCase().padStart(4,'0')} · ${this.text(category)}\n${this.text('lastValue')}: ${value}\n\n${this.text(`${category}Meaning`)}\n${this.reservationReason(address)}\n\n${statistics}\n${this.text('readFrom')}:\n${[...reads].join('\n') || '—'}\n${this.text('writeFrom')}:\n${[...writes].join('\n') || '—'}${truncated ? `\n${this.text('truncated')}` : ''}\n${this.text('coverage')}:\n${[...coverage].join('\n') || '—'}`;
    }
    async exportRecords() {
        try {
            const sessions = await this.records();
            const blob = new Blob([JSON.stringify({ format:'moaikun-ram-recording', version:1, exportedAt:Date.now(), sessions })], { type:'application/json' });
            const url = URL.createObjectURL(blob);
            const link = this.ui.document.createElement('a'); link.href = url;
            link.download = `moaikun-ram-${new Date().toISOString().slice(0,10)}.json`; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) { this.fail(error); }
    }
    async importRecords(file) {
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            if (data.format !== 'moaikun-ram-recording' || data.version !== 1 || !Array.isArray(data.sessions)) throw new Error('Invalid RAM backup');
            // Validate every record before writing anything. Stable IDs/revisions
            // make repeated imports idempotent rather than doubling counters.
            const sessions = data.sessions.map(record => RamAccessTracker.validate(record));
            for (const session of sessions) { this.store.journal(session); await this.store.put(session); }
            await this.refreshView();
        } catch (error) { this.fail(error); this.ui.get('ramRecordingResult').textContent = `${this.text('error')}: ${error.message}`; }
    }
}

RamRecorder.TEXT = {
    'zh-CN': {
        enabled:'RAM 观察记录（默认关闭）', gameplay:'进入关卡后记录；加载访问另列', boot:'从启动开始记录（下次测试生效）',
        hint:'开启状态与记录保存在此浏览器、此站点。每 3 秒及停止/隐藏页面时保存。清除站点数据会删除记录，建议定期导出备份。',
        view:'查看 RAM 记录', off:'记录已关闭', armed:'已开启，等待测试游戏', waiting:'正在记录加载访问，等待关卡就绪', recording:'正在记录', saved:'已保存', error:'保存/读取失败，记录尚未确认持久保存',
        title:'RAM 使用观察', explanation:'记录模拟器实际执行的 RAM 读写，包括同值写入、栈与精灵 DMA；不记录浏览器存读档的复制。未访问只是候选，分配前仍需检查数组、间接访问与未覆盖场景。',
        refresh:'刷新统计', export:'导出备份', import:'导入备份', close:'关闭', all:'全部 ROM 访问并集', address:'地址', reads:'读取', writes:'写入', changes:'变化',
        loadingReads:'加载读取', loadingWrites:'加载写入', loadingChanges:'加载变化', state:'状态',
        unseen:'未观察到访问', loading:'仅加载阶段写入', written:'游戏写入，无读取', read:'已读取', reserved:'预设保留区域',
        sessions:'次记录', candidates:'个待核查候选', frames:'帧', readFrom:'读取来源', writeFrom:'写入来源', coverage:'已观察的场景/状态', truncated:'来源只保留每次记录最先 4 个；还有其他来源，计数不截断。',
        legend:'每行 16 字节，行地址 + 顶部列偏移 = 完整地址。点击格子查看详情；方向键移动，Page Up/Down 翻页。黑色表示该类别未勾选。',
        valueHint:'格子显示最后一次观察到的读/写数值（十六进制）；-- 表示尚未观察或旧记录没有数值。所有类别都记录最后值，每 3 秒随统计保存，不保存数值历史。合并显示按每个地址的观察时间取最新值，可能来自不同 ROM/测试，不是一份同时刻 RAM 快照。连续 00/FF 只是初始化线索，不能证明地址空闲。',
        lastValue:'最后观察数值', unknownValue:'--（尚未观察到数值，或旧记录未保存数值）', observedAt:'观察时间', valueSource:'数值来源 ROM / 测试记录',
        mapFilterTitle:'图像颜色筛选', candidatesOnly:'仅突出灰色和黄色候选', showAll:'全选',
        filterHint:'勾选的类别显示原色，未勾选显示黑色，仍可点击查看。筛选不改变记录或候选数量；选择会保存在浏览器。',
        meaningTitle:'颜色、候选数量与保留区域的详细说明', unseenCount:'浅灰', loadingCount:'黄色',
        emptyNote:'尚未记录执行访问。此时的候选数量只是排除了预设保留范围，不能视为已经发现空闲内存。',
        unseenMeaning:'加载与游戏阶段的读取、写入均为 0。只说明已覆盖的测试中没有访问，不能保证未测试的功能不会使用。',
        loadingMeaning:'加载写入大于 0，加载读取、游戏读取及游戏写入均为 0。可能只是初始化，也可能用于未覆盖的功能。黄色与浅灰一起计入待核查候选。',
        writtenMeaning:'游戏统计列有写入，但加载与游戏统计列都没有读取。可能属于临时状态或尚未覆盖的读取路径，不计入当前优先候选。',
        readMeaning:'加载或游戏阶段至少观察到一次读取。即使数值一直不变，也表示有程序读取了它；默认按已使用处理。',
        reservedMeaning:'根据硬件规则或现有游戏/补丁代码预先标注，运行前就存在。整块保留不代表每个字节都实际使用；实际读写次数可点击格子查看，不计入优先候选。',
        enemyBirthReason:'补丁分配：$0075–$007C 保存八个敌人各自的出生屏幕，供双屏关卡复活使用。历史记录可能来自分配前的 ROM。',
        playerYReason:'补丁分配：$007D 为玩家 Y 的有符号高字节；$FF 表示位于地图上方，$00 表示正常屏幕范围。历史记录可能来自分配前的 ROM。',
        stackReason:'预设依据：$0100–$01FF 是 CPU 固定栈地址范围。',
        bufferReason:'预设依据：$0200–$03FF 是游戏精灵/背景命令缓冲区域，按整块保守保留。',
        mapReason:'预设依据：地图位于 $0700 页；目前整页保留，其中可能有未使用空隙。',
        variableReason:'预设依据：现有代码明确使用的补丁或坐标变量。', notReserved:'该地址未列入预设保留范围，分配前仍需核查代码。'
    },
    'en-US': {
        enabled:'RAM recording (off by default)', gameplay:'Record after stage loads; startup shown separately', boot:'Record from boot (next test)',
        hint:'Settings and records stay in this browser/site. Saves every 3 seconds and on stop/page hide. Clearing site data deletes records; export backups regularly.',
        view:'View RAM records', off:'Recording off', armed:'Enabled; waiting for a game test', waiting:'Recording startup; waiting for gameplay', recording:'Recording', saved:'Saved', error:'Storage failed; durable save is unconfirmed',
        title:'RAM access records', explanation:'Records JSNES functional reads/writes, including same-value writes, stack and sprite DMA. Host save/load copies are excluded. Unobserved addresses are candidates only; audit arrays, indirect accesses and untested scenes before allocating.',
        refresh:'Refresh', export:'Export backup', import:'Import backup', close:'Close', all:'Union of all ROMs', address:'Address', reads:'Reads', writes:'Writes', changes:'Changes',
        loadingReads:'Startup reads', loadingWrites:'Startup writes', loadingChanges:'Startup changes', state:'Status', unseen:'Unobserved', loading:'Startup writes only', written:'Gameplay writes, no reads', read:'Read', reserved:'Pre-marked reserved',
        sessions:'sessions', candidates:'candidates to audit', frames:'frames', readFrom:'Read sources', writeFrom:'Write sources', coverage:'Observed scenes/states', truncated:'Only the first 4 sources per session are retained; more exist. Counts are complete.',
        legend:'16 bytes per row: row address + column offset = full address. Click a cell for details; arrow keys move, Page Up/Down jump a page. Black means unchecked.',
        valueHint:'Cells show the last observed read/write value in hex; -- means unobserved or missing from an older recording. All categories keep their last value, saved with counters every 3 seconds, without value history. Combined views choose the latest observation per address, possibly from different ROMs/tests, not one simultaneous RAM snapshot. Runs of 00/FF suggest initialization but do not prove free memory.',
        lastValue:'Last observed value', unknownValue:'-- (unobserved, or absent from an older recording)', observedAt:'Observed at', valueSource:'Value source ROM / session',
        mapFilterTitle:'Map color filters', candidatesOnly:'Highlight gray/yellow candidates only', showAll:'Select all',
        filterHint:'Checked categories keep their colors; unchecked categories appear black and remain clickable. Records and candidate totals are unchanged. Choices stay in this browser.',
        meaningTitle:'Color meanings, candidate totals and reserved regions', unseenCount:'light gray', loadingCount:'yellow',
        emptyNote:'No execution accesses recorded yet. This candidate count only excludes pre-marked reserved regions; it is not evidence of unused RAM.',
        unseenMeaning:'Zero reads and writes in both startup and gameplay columns. This describes observed tests only; untested features may still use the address.',
        loadingMeaning:'Startup writes are nonzero; startup reads, gameplay reads and gameplay writes are zero. This may be initialization or an untested feature. Yellow plus light gray form the candidate total.',
        writtenMeaning:'Writes in the gameplay columns, but no reads in either phase. A temporary state or an untested reader may use it. Excluded from priority candidates.',
        readMeaning:'At least one observed read during startup or gameplay. An unchanged value can still be read; treated as used by default.',
        reservedMeaning:'Marked in advance from hardware rules or existing game/patch code. Reserving a whole region does not prove every byte is used. Click a cell for actual access counts; excluded from priority candidates.',
        enemyBirthReason:'Patch allocation: $0075–$007C store the eight enemy birth pages for wide-level respawns. Historical records may come from older ROMs.',
        playerYReason:'Patch allocation: $007D is the signed player Y high byte; $FF means above the map, $00 the normal screen range. Historical records may come from older ROMs.',
        stackReason:'Pre-marked basis: $0100–$01FF is the fixed CPU stack range.',
        bufferReason:'Pre-marked basis: the game uses $0200–$03FF for sprite/background command buffers; the whole region is conservatively reserved.',
        mapReason:'Pre-marked basis: the map occupies page $0700. The whole page is reserved, potentially including unused gaps.',
        variableReason:'Pre-marked basis: a patch or coordinate variable explicitly used by existing code.', notReserved:'Outside the pre-marked reserved ranges; code review is still required before allocation.'
    },
    'ja-JP': {
        enabled:'RAM アクセス記録（初期状態は無効）', gameplay:'ステージ開始後に記録・ロード時は別集計', boot:'起動時から記録（次回テストから）',
        hint:'設定と記録はこのブラウザー・サイトに保存します。3 秒ごと、停止時、ページ非表示時に保存。サイトデータを消すと記録も消えるため、定期的にバックアップしてください。',
        view:'RAM 記録を見る', off:'記録は無効', armed:'有効・ゲームテスト待ち', waiting:'ロード時のアクセスを記録中', recording:'記録中', saved:'保存済み', error:'保存・読み込み失敗：永続保存は未確認',
        title:'RAM アクセス記録', explanation:'同じ値の書き込み、スタック、スプライト DMA を含む JSNES のアクセスを記録。セーブ・ロード時のホスト側コピーは除外。未観測アドレスは候補です。使用前に配列・間接参照・未テスト場面を確認してください。',
        refresh:'更新', export:'バックアップ出力', import:'バックアップ読込', close:'閉じる', all:'全 ROM のアクセス統合', address:'アドレス', reads:'読込', writes:'書込', changes:'変更',
        loadingReads:'ロード読込', loadingWrites:'ロード書込', loadingChanges:'ロード変更', state:'状態', unseen:'アクセス未観測', loading:'ロード時のみ書込', written:'ゲーム中書込・読込なし', read:'読込あり', reserved:'事前指定の予約領域',
        sessions:'記録', candidates:'確認が必要な候補', frames:'フレーム', readFrom:'読込元', writeFrom:'書込元', coverage:'観測した場面・状態', truncated:'各記録の最初の 4 件の参照元のみ保持。ほかにも参照元あり。回数は省略していません。',
        legend:'1 行 16 バイト。行アドレス + 列オフセット = 完全なアドレス。セルをクリックで詳細。矢印キーで移動、Page Up/Down でページ移動。黒は未選択の分類です。',
        valueHint:'セルは最後に観測した読込・書込値を 16 進数で表示。-- は未観測または旧記録に値なし。全分類の最後の値を 3 秒ごとに統計と保存し、値の履歴は残しません。統合時は各アドレスの最新の観測を採用するため、異なる ROM・テストの値が混在し、同時刻の RAM スナップショットではありません。連続する 00/FF は初期化の手掛かりで、空き RAM の証明ではありません。',
        lastValue:'最後に観測した値', unknownValue:'--（未観測、または旧記録に値なし）', observedAt:'観測時刻', valueSource:'値の元 ROM / テスト記録',
        mapFilterTitle:'図の色フィルター', candidatesOnly:'灰色・黄色の候補のみ強調', showAll:'すべて選択',
        filterHint:'選択した分類は元の色、未選択は黒でクリック可能です。記録・候補数は変えません。選択はブラウザーに保存します。',
        meaningTitle:'色・候補数・予約領域の詳細', unseenCount:'薄灰', loadingCount:'黄色',
        emptyNote:'実行時アクセスはまだ未記録です。候補数は事前指定の予約領域を除外しただけで、空き RAM の証明ではありません。',
        unseenMeaning:'ロードとゲームの読込・書込がすべて 0。観測したテストで未使用だっただけで、未テスト機能が使う可能性があります。',
        loadingMeaning:'ロード書込はあり、両段階の読込とゲーム書込は 0。初期化や未テスト機能の可能性があります。黄色と薄灰の合計が候補数です。',
        writtenMeaning:'ゲーム統計列で書込あり、両段階で読込なし。一時状態や未テストの読込元が使う可能性があり、優先候補には含めません。',
        readMeaning:'ロードまたはゲームで少なくとも 1 回読込を観測。値が変化しなくても読込は使用の証拠として扱います。',
        reservedMeaning:'ハードウェア規則や既存のゲーム・パッチコードから事前指定。領域全体の予約は全バイトの使用を証明しません。セルをクリックで実アクセス回数を表示。優先候補から除外します。',
        enemyBirthReason:'パッチ割当：$0075–$007C に8体の敵の出生画面を保存し、横2画面での復活に使用。過去の記録は旧ROMの場合があります。',
        playerYReason:'パッチ割当：$007D はプレイヤーYの符号付き上位バイト。$FF はマップ上方、$00 は通常画面内。過去の記録は旧ROMの場合があります。',
        stackReason:'指定根拠：$0100–$01FF は CPU 固定のスタック範囲です。',
        bufferReason:'指定根拠：$0200–$03FF のスプライト・背景コマンドバッファを領域全体で保守的に予約しています。',
        mapReason:'指定根拠：マップの $0700 ページ全体を予約。未使用の隙間が含まれる可能性があります。',
        variableReason:'指定根拠：既存コードが明示的に使用するパッチ・座標変数です。', notReserved:'事前指定範囲外ですが、使用前にコード確認が必要です。'
    }
};

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => RamRecorder.getInstance().mount(document));
}
if (typeof module !== 'undefined' && module.exports) module.exports = { RamRecordingStore, RamAccessTracker, RamRecorder };
