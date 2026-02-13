/**
 * ROM 文件缓存管理器（使用 IndexedDB）
 * 
 * 存储结构：
 * - 'originalRom': 原始 ROM 数据（未修改的）
 * - 'levelData': 所有关卡数据（独立于 ROM 存储）
 * - 'backupLevels': 未保存的关卡备份列表
 */
class RomCache {
    static instance = null;
    
    constructor() {
        this.dbName = 'MoaikunRomCache';
        this.storeName = 'roms';
        this.db = null;
        this.cacheKey = 'lastRom';
        this.levelDataKey = 'levelData';
        this.backupKey = 'backupLevels';
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
            const request = indexedDB.open(this.dbName, 2);
            
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
     * 保存原始 ROM 文件到缓存（玩家上传时调用，只保存原始未修改的 ROM）
     * @param {ArrayBuffer} data - 原始 ROM 数据
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
                size: data.byteLength || data.length
            };
            
            const request = store.put(romData, this.cacheKey);
            
            request.onsuccess = () => {
                console.log(`ROM 已缓存: ${fileName} (${romData.size} 字节)`);
                resolve();
            };
            
            request.onerror = () => {
                console.error('缓存 ROM 失败:', request.error);
                reject(request.error);
            };
        });
    }
    
    /**
     * 保存关卡数据到缓存（独立于 ROM 保存）
     * @param {Array} levelsData - 序列化的关卡数据数组
     * @param {number} levelCount - 关卡总数
     * @param {number} romType - ROM 类型（0=原始，1=扩展）
     */
    async saveLevelData(levelsData, levelCount, romType) {
        if (!this.db) {
            await this.init();
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            
            const data = {
                levels: levelsData,
                levelCount: levelCount,
                romType: romType,
                timestamp: Date.now()
            };
            
            const request = store.put(data, this.levelDataKey);
            
            request.onsuccess = () => {
                console.log(`关卡数据已缓存: ${levelsData.length} 个关卡`);
                resolve();
            };
            
            request.onerror = () => {
                console.error('缓存关卡数据失败:', request.error);
                reject(request.error);
            };
        });
    }
    
    /**
     * 从缓存加载关卡数据
     * @returns {Promise<{levels: Array, levelCount: number}|null>}
     */
    async loadLevelData() {
        if (!this.db) {
            await this.init();
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(this.levelDataKey);
            
            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    console.log(`从缓存加载关卡数据: ${result.levels.length} 个关卡`);
                    resolve(result);
                } else {
                    console.log('缓存中没有关卡数据');
                    resolve(null);
                }
            };
            
            request.onerror = () => {
                console.error('读取关卡缓存失败:', request.error);
                reject(request.error);
            };
        });
    }
    
    /**
     * 保存备份关卡到缓存
     * @param {Array} backupLevels - 序列化的备份关卡数组
     */
    async saveBackupLevels(backupLevels) {
        if (!this.db) {
            await this.init();
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            
            const data = {
                backups: backupLevels,
                timestamp: Date.now()
            };
            
            const request = store.put(data, this.backupKey);
            
            request.onsuccess = () => {
                console.log(`备份关卡已缓存: ${backupLevels.length} 个`);
                resolve();
            };
            
            request.onerror = () => {
                console.error('缓存备份关卡失败:', request.error);
                reject(request.error);
            };
        });
    }
    
    /**
     * 从缓存加载备份关卡
     * @returns {Promise<Array|null>}
     */
    async loadBackupLevels() {
        if (!this.db) {
            await this.init();
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(this.backupKey);
            
            request.onsuccess = () => {
                const result = request.result;
                if (result && result.backups) {
                    console.log(`从缓存加载备份关卡: ${result.backups.length} 个`);
                    resolve(result.backups);
                } else {
                    resolve([]);
                }
            };
            
            request.onerror = () => {
                console.error('读取备份缓存失败:', request.error);
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
            const request = store.clear();
            
            request.onsuccess = () => {
                console.log('所有缓存已清除');
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
