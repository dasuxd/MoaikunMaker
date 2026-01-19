/**
 * ROM 文件缓存管理器（使用 IndexedDB）
 */
class RomCache {
    static instance = null;
    
    constructor() {
        this.dbName = 'MoaikunRomCache';
        this.storeName = 'roms';
        this.db = null;
        this.cacheKey = 'lastRom';
    }
    
    static getInstance() {
        if (!RomCache.instance) {
            RomCache.instance = new RomCache();
        }
        return RomCache.instance;
    }
    
    /**
     * 初始化 IndexedDB
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            
            request.onerror = () => {
                console.error('无法打开 IndexedDB:', request.error);
                reject(request.error);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                console.log('IndexedDB 已初始化');
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                    console.log('创建 ObjectStore:', this.storeName);
                }
            };
        });
    }
    
    /**
     * 保存 ROM 文件到缓存
     * @param {ArrayBuffer} data - ROM 数据
     * @param {string} fileName - 文件名
     */
    async saveRom(data, fileName) {
        if (!this.db) {
            await this.init();
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            
            const romData = {
                data: data,
                fileName: fileName,
                timestamp: Date.now(),
                size: data.byteLength
            };
            
            const request = store.put(romData, this.cacheKey);
            
            request.onsuccess = () => {
                console.log(`ROM 已缓存: ${fileName} (${data.byteLength} 字节)`);
                resolve();
            };
            
            request.onerror = () => {
                console.error('缓存 ROM 失败:', request.error);
                reject(request.error);
            };
        });
    }
    
    /**
     * 从缓存加载 ROM 文件
     * @returns {Promise<{data: ArrayBuffer, fileName: string}|null>}
     */
    async loadRom() {
        if (!this.db) {
            await this.init();
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(this.cacheKey);
            
            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    console.log(`从缓存加载 ROM: ${result.fileName} (${result.size} 字节)`);
                    console.log(`缓存时间: ${new Date(result.timestamp).toLocaleString()}`);
                    resolve({
                        data: result.data,
                        fileName: result.fileName,
                        timestamp: result.timestamp,
                        size: result.size
                    });
                } else {
                    console.log('缓存中没有 ROM 文件');
                    resolve(null);
                }
            };
            
            request.onerror = () => {
                console.error('读取缓存失败:', request.error);
                reject(request.error);
            };
        });
    }
    
    /**
     * 清除缓存
     */
    async clearCache() {
        if (!this.db) {
            await this.init();
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(this.cacheKey);
            
            request.onsuccess = () => {
                console.log('缓存已清除');
                resolve();
            };
            
            request.onerror = () => {
                console.error('清除缓存失败:', request.error);
                reject(request.error);
            };
        });
    }
    
    /**
     * 检查是否有缓存
     */
    async hasCache() {
        if (!this.db) {
            await this.init();
        }
        
        const rom = await this.loadRom();
        return rom !== null;
    }
}
