/**
 * ROM Editor Class
 * Responsible for loading, parsing, modifying and saving ROM files
 */

// Notes: 1=Normal 2=Speed enemy 3=Trash can 4=Spinning in place 5=Bat 7=Circling enemy [boss in some levels] 8=Knife thrower 9=Trash can 2 10=Knife thrower
class RomEditor {
    constructor() {
        this.romData = null;
        this.levels = [];
        this.palettes = [];
        this.modified = false;
        
        // Current total level count
        this.levelCount = 56;


        // ROM type for editing/export (user's chosen mode, persisted in cache)
        this.romType = Config.ROM_TYPE_ORIGINAL;
        // ROM's actual binary type (detected from header, never modified after parse)
        this.originalRomType = Config.ROM_TYPE_ORIGINAL;
    }

    /**
     * Load ROM file
     * @param {ArrayBuffer} arrayBuffer - ROM file's ArrayBuffer
     */
    loadROM(arrayBuffer) {
        this.romData = new Uint8Array(arrayBuffer);
        this.parseROM();
        //Romfix.fixOriginalRom(this.romData);
        this.modified = false;
    }

    /**
     * Parse ROM file, read all level data
     */
    parseROM() {
        if (!this.romData) return;

        this.romType = this.romData[Config.ROM_TYPE_ADDRESS] === 0x21 ? Config.ROM_TYPE_EXPANDED : Config.ROM_TYPE_ORIGINAL;
        // originalRomType reflects the actual ROM binary layout, used for resource/graphics loading
        this.originalRomType = this.romType;

        this.levels = [];
        
        // 0. Read total level count
        this.levelCount = this.romData[Config.LEVEL_COUNT_ADDRESS] - 1;

        // 1. Read address table (little endian)
        //const addresses = this.readLevelAddressTable();
        const levelDataAddresses = this.readLevelAddressTable();
        
        // 2. Read enemy data address

        // 3. Read each level's data
        let currentEnemyAddr = this.getEnemyDataStart();
        
        for (let i = 0; i < this.levelCount; i++) {
            const startAddr = levelDataAddresses[i].romAddress;
            const levelData = this.readLevelData(startAddr);
            
            // Read enemy data, and update next read position
            const enemyData = this.getEnemyDataByAddr(currentEnemyAddr);
            const enemyCpuAddress = this.getCpuAddressByRomAddress(currentEnemyAddr, Config.LEVEL_TABLE_ENEMY_BANK_INDEX);

            const level = new Level(
                i,
                levelDataAddresses[i].cpuAddress,
                levelDataAddresses[i].romAddress,
                levelData,
                enemyData,
                enemyCpuAddress,
                currentEnemyAddr
            );

            currentEnemyAddr = currentEnemyAddr + enemyData.length; // Update to next level's monster data address

            this.levels.push(level);
        }
    }

    /**
     * Read address table
     * @private
     */
    readLevelAddressTable() {
        const addresses = [];
        
        for (let i = 0; i < this.levelCount; i++) {
            const offset = this.getLevelAddressTable() + i * 2;
            const lowByte = this.romData[offset];
            const highByte = this.romData[offset + 1];
            const cpuAddress = (highByte << 8) | lowByte;
            let bankIndex = 1;
            if(this.romType === Config.ROM_TYPE_EXPANDED){
                bankIndex = Config.LEVEL_DATA_BANK_INDEX;
            }
            const romAddress = this.getRomAddressByCpuAddress(cpuAddress, bankIndex);
            
            addresses.push({ cpuAddress, romAddress });
        }

        return addresses;
    }

    // updateLevelAddresses(){
    //     // Find original start address
    //     const offset = Config.ADDRESS_TABLE_START + 2;
    //     const lowByte = this.romData[offset];
    //     const highByte = this.romData[offset + 1];
    //     const firstLevelCpuAddress = (highByte << 8) | lowByte;
    //     const romAddress = firstLevelCpuAddress + Config.ADDRESS_OFFSET;
    //     for (let i=0; i<this.levels.length; i++){
    //         if (i===0){
    //             this.levels[i].updateAddress(
    //                 firstLevelCpuAddress,
    //                 romAddress
    //             );
    //         }else{
    //             const prevLevel = this.levels[i-1];
    //             this.levels[i].updateAddress(
    //                 prevLevel.cpuAddress + prevLevel.getTotalSize(),
    //                 prevLevel.romAddress + prevLevel.getTotalSize()
    //             );
    //         }
    //     }
    // }

    // /**
    //  * Read monster data address
    //  * @private
    //  */
    // static readMonsterAddress(romData) {
    //     const lowByte = romData[Config.MONSTER_ADDRESS_OFFSET];
    //     const highByte = romData[Config.MONSTER_ADDRESS_OFFSET + 1];
    //     const cpuAddress = (highByte << 8) | lowByte;
    //     const romAddress = cpuAddress + Config.ADDRESS_OFFSET;
    //     return romAddress;
    // }

    // /**
    //  * Read single level's monster data
    //  * @param {number} startAddr - Current level monster data start address
    //  * @returns {Object} Object containing data and next address
    //  * @private
    //  */
    // readMonsterData(startAddr) {
    //     // Read first byte (monster count * 2 + 1)
    //     const firstByte = this.romData[startAddr];
        
    //     if (firstByte === 0x01 || firstByte === 0x00) {
    //         // No monsters, data is only 1 byte
    //         return {
    //             data: [firstByte],
    //             nextAddress: startAddr + 1
    //         };
    //     }
        
    //     // Calculate data length (first byte is data length)
    //     const dataLength = firstByte;
    //     const monsterData = Array.from(this.romData.slice(startAddr, startAddr + dataLength));
        
    //     return {
    //         data: monsterData,
    //         nextAddress: startAddr + dataLength
    //     };
    // }

    // /**
    //  * Find FF separator position
    //  * Note: First 4 bytes cannot be end marker, search from 5th byte
    //  * @private
    //  */
    // findSeparator(startAddr, endAddr) {
    //     // Skip first 4 bytes, start searching for FF separator from 5th byte (index startAddr+4)
    //     for (let j = startAddr + 4; j < endAddr; j++) {
    //         if (this.romData[j] === 0xFF) {
    //             return j;
    //         }
    //     }
    //     return endAddr;
    // }

    readLevelData(dataStartAddr){
        // Find end address
        let data = [];
        for(let i = 0; i < Config.LEVEL_DATA_MAX_SIZE; i++){
            const byte = this.romData[dataStartAddr + i];
            if(byte === 0xFF){
                break;
            }else{
                data.push(byte);
            }
        }
        return data;
    }

    /**
     * Get level
     * @param {number} index - Level index
     */
    getLevel(index) {
        return this.levels[index];
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
        return this.levels.reduce((total, level) => total + level.getTotalSize(), 0);
    }

    /**
     * Check if boundary will be exceeded
     * @param {number} levelIndex - Index of level to modify
     * @param {number} newSize - New data size
     */
    checkBoundary(levelIndex, newSize) {
        let totalSize = 0;
        
        for (let i = 0; i < this.levelCount; i++) {
            if (i === levelIndex) {
                totalSize += newSize + 1; // +1 for FF separator
            } else {
                totalSize += this.levels[i].getTotalSize();
            }
        }

        const firstLevelStart = this.levels[0].romAddress;
        const totalEnd = firstLevelStart + totalSize;
        const maxAllowed = Config.DATA_START_MAX - firstLevelStart;

        return {
            valid: totalEnd <= Config.DATA_START_MAX,
            totalSize,
            maxAllowed,
            totalEnd
        };
    }

    // /**
    //  * Recalculate all level addresses
    //  * @private
    //  */
    // recalculateAddresses(levels) {
    //     let currentPos = this.getLevelDataStart()

    //     for (let i = 0; i < levels.length; i++) {
    //         const level = levels[i];
    //         const endPos = currentPos + level.getTotalSize();

    //         // Check boundary
    //         if (endPos > this.getLevelUsageMaxSize()) {
    //             return {
    //                 success: false,
    //                 //error: `Level data total size exceeds boundary! Level ${i + 1} end address is 0x${endPos.toString(16).toUpperCase()}, exceeds max address 0x7F93. Cannot save!`
    //                 error: i18n.t('levelDataExceedBoundaryError', {level: i + 1, endAddr: '0x' + endPos.toString(16).toUpperCase(), maxAddr: '0x7F93' })
    //             };
    //         }

    //         // Update address
    //         const newRomAddress = currentPos;
    //         const newCpuAddress = newRomAddress - Config.ADDRESS_OFFSET;
    //         level.updateAddress(newCpuAddress, newRomAddress);

    //         currentPos = endPos;
    //     }

    //     return { success: true };
    // }

    updateLevelInfo(){
        let currentPos = this.getLevelDataStart();
        let monsterDataPos = this.getEnemyDataStart();
        for(let i = 0; i < this.levels.length; i++){
            const level = this.levels[i];
            level.romAddress = currentPos;
            level.cpuAddress = this.getCpuAddressByRomAddress(currentPos);
            currentPos += level.getTotalSize();

            level.monsterRomAddress = monsterDataPos;
            level.monsterCpuAddress = this.getCpuAddressByRomAddress(monsterDataPos);
            monsterDataPos += level.monsterData.length;
        }

        //保存到 RomCache
        //RomCache.saveCache(this.levels, this.levelCount);

        return { success: true };
    }

    /**
     * Check if total enemy count exceeds the maximum allowed (78 enemies)
     * @param {Array} levels - Array of level objects
     * @param {number} levelCount - Number of levels
     * @returns {Object} Object containing valid status and error message if invalid
     */
    static checkTotalEnemyCount(levels, levelCount) {
        const MAX_ENEMY_COUNT = 78; // Maximum total enemies due to ROM storage structure
        
        // Calculate total enemy count across all levels
        let totalEnemies = 0;
        for (let i = 0; i < levelCount; i++) {
            const monsterData = levels[i].monsterData;
            if (monsterData && monsterData.length > 0) {
                // First byte is (enemy count * 2 + 1), so calculate actual enemy count
                const enemyCount = Math.floor((monsterData[0] - 1) / 2);
                totalEnemies += enemyCount;
            }
        }
        
        if (totalEnemies > MAX_ENEMY_COUNT) {
            return {
                valid: false,
                totalEnemies: totalEnemies,
                maxEnemies: MAX_ENEMY_COUNT,
                error: i18n.t('totalEnemyCountExceedError', {
                    currentCount: totalEnemies,
                    maxCount: MAX_ENEMY_COUNT
                })
            };
        }
        
        return {
            valid: true,
            totalEnemies: totalEnemies,
            maxEnemies: MAX_ENEMY_COUNT
        };
    }

    recalDataAddresses(levels = this.levels){
        let currentLevelDataPos = this.getLevelDataStart()
        let currentEnemyDataPos = this.getEnemyDataStart();
        for (let i=0; i < levels.length; i++){
            const level = levels[i];
            level.romAddress = currentLevelDataPos;
            level.cpuAddress = this.getCpuAddressByRomAddress(currentLevelDataPos);
            currentLevelDataPos += level.getTotalSize() + 1; // +1 for FF separator

            level.monsterRomAddress = currentEnemyDataPos;
            level.monsterCpuAddress = this.getCpuAddressByRomAddress(currentEnemyDataPos);
            currentEnemyDataPos += level.monsterData.length;
        }

    }

    checkRomData(){
        const maxSize = this.getLevelUsageMaxSize();
        // Calculate total size of all level data
        let totalSize = 0;
        let enemySize = 0;
        for (let i = 0; i < this.levelCount; i++) {
            totalSize += this.levels[i].getTotalSize(); // includes FF separator
            enemySize += this.levels[i].monsterData.length;
        }

        if(totalSize > maxSize){
            return {success: false, error: i18n.t('levelDataSizeExceedError', {
                currentSize: totalSize,
                maxSize: maxSize
            })};
        }

        const maxLevelAddressSize = this.getLevelAddressTableEnd() - this.getLevelAddressTable();
        if(this.levelCount * 2 > maxLevelAddressSize){
            return {success: false, error: i18n.t('levelAddressTableSizeExceedError', {
                currentSize: this.levelCount * 2,
                maxSize: maxLevelAddressSize
            })};
        }

        const maxEnemyDataSize = this.getEnemyUsageMaxSize();
        if(enemySize > maxEnemyDataSize){
            return {success: false, error: i18n.t('enemyDataSizeExceedError', {
                currentSize: enemySize,
                maxSize: maxEnemyDataSize
            })};
        }

        return {success: true};
    }

    //

    /**
     * Get ROM data for download
     */
    getROMData(levels = this.levels, levelCount = this.levelCount) {
        // check data
        // let result = this.checkRomData()
        // if(result.success === false){
        //     return result;
        // }

        this.recalDataAddresses(levels);
       
        //
        let expandedRomSize = 0;
        if(this.romType === Config.ROM_TYPE_EXPANDED){
            expandedRomSize = 0x4000 * 4; // expanded rom size
        }
        let newRomData = new Uint8Array(this.romData.length + expandedRomSize);

        //1、 copy bank 1
        newRomData.set(this.romData.subarray(0, 0x4010), 0);

        //获取原 rom type
        const romType = this.romData[Config.ROM_TYPE_ADDRESS];
        const pgrBank2 = new Uint8Array(0x4000);
        //2、 copy bank 2
        if(romType === 0x21){
            pgrBank2.set(this.romData.subarray(Config.PGR_PART_2_BANK_INDEX * 0x4000 + 0x10, ), 0) 
        }else{
            pgrBank2.set(this.romData.subarray(0x4010, 0x8010), 0) 
        }

        if(this.romType === Config.ROM_TYPE_EXPANDED){
            newRomData.set(pgrBank2, Config.PGR_PART_2_BANK_INDEX * 0x4000 + 0x10);
        }else{
            newRomData.set(pgrBank2, 0x4010);
        }

        //3、 CHR
        newRomData.set(this.romData.subarray(0x8010, 0x10010), 0x8010);
        
        //4、 handle levels
        // level data
        newRomData.fill(0x00, this.getLevelDataStart(), this.getLevelDataStart() + this.getLevelUsageMaxSize());
        // level table
        newRomData.fill(0x00, this.getLevelAddressTable(), this.getLevelAddressTableEnd());
        // enemy data
        newRomData.fill(0x00, this.getEnemyDataStart(), this.getEnemyDataStart() + this.getEnemyUsageMaxSize());

        if(this.romType === Config.ROM_TYPE_EXPANDED){
            let offset = (Config.PGR_PART_2_BANK_INDEX - 1) * 0x4000;
            newRomData.fill(0x00, Config.LEVEL_ADDRESS_TABLE_ORIGINAL + offset, Config.LEVEL_ADDRESS_TABLE_END_ORIGINAL + offset);
            newRomData.fill(0x00, Config.LEVEL_DATA_ORIGINAL + offset, Config.LEVEL_DATA_END_ORIGINAL + offset);
            newRomData.fill(0x00, Config.ENEMY_DATA_ORIGINAL, Config.ENEMY_DATA_END_ORIGINAL);
            newRomData.fill(0x90, Config.LEVEL_TIMER_EXPANDED, Config.LEVEL_TIMER_EXPANDED + 0x100); //256 levels
        }

        newRomData[Config.LEVEL_COUNT_ADDRESS] = levelCount + 1;

        for(let i = 0; i < levelCount; i++){
            const levelAddr = levels[i].cpuAddress;
            newRomData.set([levelAddr & 0xFF, (levelAddr >> 8) & 0xFF], this.getLevelAddressTable() + i * 2);
            newRomData.set(levels[i].data, levels[i].romAddress);
            newRomData[levels[i].romAddress + levels[i].data.length] = 0xFF;
            newRomData.set(levels[i].monsterData, levels[i].monsterRomAddress);

            if(this.romType === Config.ROM_TYPE_EXPANDED){
                newRomData[Config.ENEMY_ADDRESS_TABLE_EXPANDED + i * 2] = levels[i].monsterCpuAddress & 0xFF
                newRomData[Config.ENEMY_ADDRESS_TABLE_EXPANDED + i * 2 + 1] = (levels[i].monsterCpuAddress >> 8) & 0xFF
            }
        }

        if(this.romType === Config.ROM_TYPE_EXPANDED){
           Romfix.expandRomCode(newRomData);
           
        }

        // fix other data
        Romfix.fixOriginalRom(newRomData, this.romType === Config.ROM_TYPE_EXPANDED);
        return newRomData;
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
        if (count < 1 || count > this.getMaxCountOfLevels()) {
            return { success: false, error: i18n.t('invalidLevelCountMessageError', { maxLevelCount: this.getMaxCountOfLevels() }) };
        }
        
        this.levelCount = count; // Actual stored value is 1 more than displayed value
        this.modified = true;
        
        // Write to ROM immediately
        this.romData[Config.LEVEL_COUNT_ADDRESS] = this.levelCount + 1;
        
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
        this.romData[Config.LEVEL_COUNT_ADDRESS] = this.levelCount + 1;
        
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
        
        this.recalDataAddresses()
        
        return true;
    }

    getLevelAddressTable(){
        if(this.romType === Config.ROM_TYPE_ORIGINAL){
            return Config.LEVEL_ADDRESS_TABLE_ORIGINAL
        }else if(this.romType === Config.ROM_TYPE_EXPANDED){
            return Config.LEVEL_ADDRESS_TABLE_EXPANDED;
        }
    }

    getLevelAddressTableEnd(){
        if(this.romType === Config.ROM_TYPE_ORIGINAL){
            return Config.LEVEL_ADDRESS_TABLE_END_ORIGINAL
        }else if(this.romType === Config.ROM_TYPE_EXPANDED){
            return Config.LEVEL_ADDRESS_TABLE_END_EXPANDED;
        }
    }

    getLevelDataStart(){
        if(this.romType === Config.ROM_TYPE_ORIGINAL){
            return Config.LEVEL_DATA_ORIGINAL
        }else if(this.romType === Config.ROM_TYPE_EXPANDED){
            return Config.LEVEL_DATA_EXPANDED;
        }
    }

    getLevelDataEnd(){
        if(this.romType === Config.ROM_TYPE_ORIGINAL){
            return Config.LEVEL_DATA_END_ORIGINAL
        }else if(this.romType === Config.ROM_TYPE_EXPANDED){
            return Config.LEVEL_DATA_END_EXPANDED;
        }
    }

    getMaxCountOfLevels(){
        let maxCount = 0;
        if(this.romType === Config.ROM_TYPE_ORIGINAL){
            maxCount = (Config.LEVEL_ADDRESS_TABLE_END_ORIGINAL - Config.LEVEL_ADDRESS_TABLE_ORIGINAL) / 2;
        }else if(this.romType === Config.ROM_TYPE_EXPANDED){
            maxCount = (Config.LEVEL_ADDRESS_TABLE_END_EXPANDED - Config.LEVEL_ADDRESS_TABLE_EXPANDED) / 2;
        }

        if(maxCount > 0x7F){
            maxCount = 0x7F;
        }
        return maxCount
    }

    getLevelUsageMaxSize(){
        if(this.romType === Config.ROM_TYPE_ORIGINAL){
            return Config.LEVEL_DATA_END_ORIGINAL - Config.LEVEL_DATA_ORIGINAL;
        }else if(this.romType === Config.ROM_TYPE_EXPANDED){
            return Config.LEVEL_DATA_END_EXPANDED - Config.LEVEL_DATA_EXPANDED;
        }
    }

    getEnemyDataStart(){
        if(this.romType === Config.ROM_TYPE_ORIGINAL){
            return Config.ENEMY_DATA_ORIGINAL;
        }else if(this.romType === Config.ROM_TYPE_EXPANDED){
            return Config.ENEMY_DATA_EXPANDED;
        }
    }

    getEnemyCountMax(){
        const maxSize = this.getEnemyUsageMaxSize();
        return (maxSize - this.levelCount) / 2
    }

    getEnemyDataByAddr(startAddr = null){
        const enemyData = [];

        if(startAddr !== null){
            const firstByte = this.romData[startAddr];
            enemyData.push(firstByte)
            for(let i = 1; i < firstByte; i++){
                const byte = this.romData[startAddr + i];
                enemyData.push(byte);
            }
        } else {
            enemyData.push(0x01)
        }

        return enemyData;
    }

    // Reserved for future implementation
    getEnemyDataByLevelIndex(levelIndex){
        return [0x01];
    }

    getEnemyUsageMaxSize(){
        if(this.romType === Config.ROM_TYPE_ORIGINAL){
            return Config.ENEMY_DATA_END_ORIGINAL - Config.ENEMY_DATA_ORIGINAL;
        }else if(this.romType === Config.ROM_TYPE_EXPANDED){
            return Config.ENEMY_DATA_END_EXPANDED - Config.ENEMY_DATA_EXPANDED;
        }   
    }

    // only for pgr rom
    getBankIndexByCpuAddress(cpuAddress){
        const tmpAddr = cpuAddress - 0x8000;
        if(tmpAddr < 0x4000){
            return Config.PGR_PART_1_BANK_INDEX;
        }else{
            if(this.romType === Config.ROM_TYPE_ORIGINAL){
                return 1;
            }else if(this.romType === Config.ROM_TYPE_EXPANDED){
                return Config.PGR_PART_2_BANK_INDEX;
            }
        }
    }

    getRomAddressByCpuAddress(cpuAddress, bankIndex = null){
        if(bankIndex === null){
            bankIndex = this.getBankIndexByCpuAddress(cpuAddress);
        }
        //return (cpuAddress - 0x8000) % 0x4000 + bankIndex * 0x4000 + 0x10;
        return (cpuAddress % 0x4000) + bankIndex * 0x4000 + 0x10;
    }

    // only for pgr rom
    getCpuAddressByRomAddress(romAddress){
        romAddress = romAddress - 0x10;
        let pgrPartIndex = 1;
        if(this.romType === Config.ROM_TYPE_EXPANDED){
            pgrPartIndex = Config.PGR_PART_2_BANK_INDEX;
        }

        if(romAddress >= pgrPartIndex * 0x4000){
            return (romAddress % 0x8000) + 0x8000;
        }
        return ((romAddress) % 0x4000) + 0x8000;
    }

    getRomAddrByOriginalRomAddr(originalRomAddr){
        if(originalRomAddr < 0x4010 || this.originalRomType === Config.ROM_TYPE_ORIGINAL){
            return originalRomAddr;
        }

        return originalRomAddr + (Config.PGR_PART_2_BANK_INDEX - 1) * 0x4000;
    }

    /**
     * Convert CPU address to ROM file offset using the original ROM's actual type.
     * Used when reading data pointers from the original ROM (e.g., for resource/graphics loading).
     * Unlike getRomAddressByCpuAddress which uses the editing romType,
     * this always uses originalRomType to ensure correct address translation
     * regardless of the user's export preference.
     */
    getRomAddressFromOriginalCpuAddress(cpuAddress){
        const tmpAddr = cpuAddress - 0x8000;
        let bankIndex;
        if(tmpAddr < 0x4000){
            bankIndex = Config.PGR_PART_1_BANK_INDEX;
        } else {
            bankIndex = this.originalRomType === Config.ROM_TYPE_EXPANDED
                ? Config.PGR_PART_2_BANK_INDEX : 1;
        }
        return (cpuAddress % 0x4000) + bankIndex * 0x4000 + 0x10;
    }


}
