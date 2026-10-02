/** Versioned project cache. Legacy data is copied once, never deleted.
 * ROM, levels and drafts remain independent; project replacement is atomic.
 */
class RomCache {
    static instance = null;
    constructor() {
        this.dbName = 'MoaikunRomCacheV3';
        this.storeName = 'roms';
        this.db = null;
        this.cacheKey = 'lastRom';
        this.levelDataKey = 'levelData';
        this.backupKey = 'backupLevels';
        this.initializing = null;
    }
    static getInstance() { return this.instance ||= new RomCache(); }
    async init() {
        if(this.initializing) return this.initializing;
        this.initializing = (async () => {
            this.db = await new Promise((resolve,reject) => {
                const request = indexedDB.open(this.dbName,1);
                request.onupgradeneeded = () => request.result.createObjectStore(this.storeName);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                request.onblocked = () => reject(new Error('Cache upgrade blocked by another tab'));
            });
            await this.migrateLegacy();
        })();
        try { await this.initializing; }
        catch(error) { this.initializing = null; this.db?.close(); this.db = null; throw error; }
    }
    read(db,key) {
        return this.readMany(db,[key]).then(values => values[0]);
    }
    readMany(db,keys) {
        return new Promise((resolve,reject) => {
            const tx = db.transaction(this.storeName,'readonly');
            const values = [];
            keys.forEach((key,index) => {
                const request = tx.objectStore(this.storeName).get(key);
                request.onsuccess = () => { values[index] = request.result ?? null; };
            });
            tx.oncomplete = () => resolve(values);
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('Cache read aborted'));
        });
    }
    write(entries, deletions = []) {
        return new Promise((resolve,reject) => {
            const tx = this.db.transaction(this.storeName,'readwrite');
            const store = tx.objectStore(this.storeName);
            tx.oncomplete = () => resolve();
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('Cache transaction aborted'));
            for(const [key,value] of entries) store.put(value,key);
            for(const key of deletions) store.delete(key);
        });
    }
    async migrateLegacy() {
        if(await this.read(this.db,'migrationInfo')) return;
        let legacy = null;
        try {
            // Never create an empty legacy DB when this is a new user.
            legacy = await new Promise((resolve,reject) => {
                const request = indexedDB.open('MoaikunRomCache');
                let absent = false;
                request.onupgradeneeded = () => { absent = true; request.transaction.abort(); };
                request.onerror = () => absent ? resolve(null) : reject(request.error);
                request.onsuccess = () => resolve(request.result);
                request.onblocked = () => reject(new Error('Legacy cache is busy'));
            });
            const keys = [this.cacheKey,this.levelDataKey,this.backupKey];
            let values = [];
            if(legacy?.objectStoreNames.contains(this.storeName)) {
                values = await this.readMany(legacy,keys);
            }
            // Check and copy within one transaction, so another new-version
            // tab cannot save a project between the check and the copy.
            await new Promise((resolve,reject) => {
                const tx = this.db.transaction(this.storeName,'readwrite');
                const store = tx.objectStore(this.storeName);
                tx.oncomplete = () => resolve();
                tx.onabort = tx.onerror = () => reject(tx.error || new Error('Cache migration aborted'));
                keys.forEach((key,index) => {
                    const request = store.get(key);
                    request.onsuccess = () => {
                        if(values[index] && request.result === undefined) store.put(values[index],key);
                    };
                });
                store.put({version:3,completedAt:Date.now()},'migrationInfo');
            });
        } finally { legacy?.close(); }
    }
    async saveRom(data,fileName) {
        await this.init();
        await this.write([[this.cacheKey,{data,fileName,timestamp:Date.now(),size:data.byteLength || data.length}]]);
    }
    async saveLevelData(levels,levelCount,romType,gameConfig = {}) {
        await this.init();
        await this.write([[this.levelDataKey,{levels,levelCount,romType,gameConfig:{...gameConfig},timestamp:Date.now()}]]);
    }
    async saveBackupLevels(backups) {
        await this.init();
        await this.write([[this.backupKey,{backups,timestamp:Date.now()}]]);
    }
    async loadRom() { await this.init(); return this.read(this.db,this.cacheKey); }
    async loadLevelData() { await this.init(); return this.read(this.db,this.levelDataKey); }
    async loadBackupLevels() { await this.init(); return (await this.read(this.db,this.backupKey))?.backups || []; }
    async loadPolicy() { await this.init(); return this.read(this.db,'romPolicy'); }
    async savePolicy(policy) { await this.init(); await this.write([['romPolicy',policy]]); }
    async saveProject(data,fileName,project,backups,policy) {
        await this.init();
        const now = Date.now();
        await this.write([
            [this.cacheKey,{data,fileName,timestamp:now,size:data.byteLength || data.length}],
            [this.levelDataKey,{...project,timestamp:now}],
            [this.backupKey,{backups,timestamp:now}],
            ['romPolicy',policy]
        ]);
    }
    async clearCache() {
        await this.init();
        // Keep the migration marker so clearing a new project cannot reimport
        // the untouched legacy database on the next page load.
        await this.write([], [this.cacheKey,this.levelDataKey,this.backupKey,'romPolicy']);
    }
    async hasCache() { return (await this.loadRom()) !== null; }
}
