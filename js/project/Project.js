class Project {
    constructor() {
        this.romData = null;
        this.levels = [];
        this.levelCount = 0;
        this.modified = false;
        this.setGameConfig();
    }
    loadROM(input) {
        const base = BaseRom.read(input);
        this.romData = base.bytes;
        this.levels = base.levels;
        this.levelCount = this.levels.length;
        this.modified = false;
        this.refreshLevelAddresses();
    }
    getROMData(levels = this.levels, count = this.levelCount, settings = this.gameConfig) {
        return buildRom(this.romData, levels, count, settings);
    }
    refreshLevelAddresses() {
        LevelLayout.calculate(this.levels, this.levelCount).entries.forEach((entry, i) =>
            Object.assign(this.levels[i], entry));
    }
    checkRomData() {
        const {mapBytes, enemyBytes} = LevelLayout.calculate(this.levels, this.levelCount);
        const error = LevelLayout.validate(this.levelCount, mapBytes, enemyBytes);
        return {success: !error, error};
    }
    getMaxCountOfLevels() { return LevelLayout.maxCount; }
    getLevelUsageMaxSize() { return LevelLayout.mapCapacity; }
    getEnemyUsageMaxSize() { return LevelLayout.enemyCapacity; }
    getLevel(index) {
        return this.levels[index];
    }

    getOriginalLevel(index) {
        // Read the unchanged base by slot number, independent of saved edits and reordering.
        return BaseRom.read(this.romData).levels[index];
    }

    /**
     * Get all levels
     */
    getAllLevels() {
        return this.levels;
    }

    /**
     * Calculate total map size of all levels
     */
    calculateTotalSize() {
        return this.levels
            .slice(0, this.levelCount)
            .reduce((total, level) => total + level.getTotalSize(), 0);
    }

    checkTotalEnemyCount(levels = this.levels, levelCount = this.levelCount) {
        const maxEnemyCount = this.getEnemyCountMax(levelCount);

        // Calculate total enemy count across all levels
        let totalEnemies = 0;
        const activeCount = Math.min(levelCount, levels.length);
        for (let i = 0; i < activeCount; i++) {
            const monsterData = levels[i].monsterData;
            if (monsterData && monsterData.length > 0) {
                // First byte is (enemy count * 2 + 1), so calculate actual enemy count
                const enemyCount = Math.floor((monsterData[0] - 1) / 2);
                totalEnemies += enemyCount;
            }
        }
        
        if (totalEnemies > maxEnemyCount) {
            return {
                valid: false,
                totalEnemies: totalEnemies,
                maxEnemies: maxEnemyCount,
                error: i18n.t('totalEnemyCountExceedError', {
                    currentCount: totalEnemies,
                    maxCount: maxEnemyCount
                })
            };
        }
        
        return {
            valid: true,
            totalEnemies: totalEnemies,
            maxEnemies: maxEnemyCount
        };
    }
    setGameConfig(config = {}) {
        this.gameConfig = GameSettings.normalize(config);
    }

    getGameConfig() {
        return { ...this.gameConfig };
    }

    /**
     * Is modified
     */
    isModified() {
        return this.modified;
    }
    
    /**
     * Get level count
     */
    getLevelCount() {
        return this.levelCount;
    }
    
    /**
     * Set level count
     * @param {number} count - Level count
     */
    setLevelCount(count) {
        if (!Number.isInteger(count) || count < 1 || count > this.getMaxCountOfLevels()) {
            return { success: false, error: i18n.t('invalidLevelCountMessageError', { maxLevelCount: this.getMaxCountOfLevels() }) };
        }
        
        this.levelCount = count; // Actual stored value is 1 more than displayed value
        this.modified = true;
        
        
        return { success: true };
    }
    
    /**
     * Export all level data as serializable object (for caching)
     * @returns {Object} Serialized level data
     */
    exportLevelsData() {
        const levelsData = this.levels.map(level => ({
            index: level.index,
            originalIndex: level.originalIndex,
            data: [...level.data],
            monsterData: [...level.monsterData],
            isDeleted: level.isDeleted,
            modified: level.modified
        }));
        return levelsData;
    }
    
    /**
     * Import level data from cache and apply to current ROM
     * @param {Array} levelsData - Serialized level data array
     * @param {number} levelCount - Level count
     */
    importLevelsData(levelsData, levelCount) {
        if (!levelsData || !Array.isArray(levelsData) || levelsData.length === 0) {
            return false;
        }
        
        // Update level count
        this.levelCount = levelCount;
        
        // Rebuild levels array
        this.levels = [];
        for (let i = 0; i < levelsData.length; i++) {
            const ld = levelsData[i];
            const level = new Level(
                ld.index,
                0, // cpuAddress will be recalculated
                0, // romAddress will be recalculated
                [...ld.data],
                [...ld.monsterData],
                0, // monsterCpuAddress will be recalculated
                0  // monsterRomAddress will be recalculated
            );
            level.originalIndex = ld.originalIndex;
            level.isDeleted = ld.isDeleted || false;
            level.modified = false;
            this.levels.push(level);
        }
        
        this.refreshLevelAddresses()
        
        return true;
    }
    getEnemyCountMax(levelCount = this.levelCount){
        const maxSize = this.getEnemyUsageMaxSize();
        return Math.max(0, Math.floor((maxSize - levelCount) / 2));
    }

}
