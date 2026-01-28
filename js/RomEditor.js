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
    }

    /**
     * Load ROM file
     * @param {ArrayBuffer} arrayBuffer - ROM file's ArrayBuffer
     */
    loadROM(arrayBuffer) {
        this.romData = new Uint8Array(arrayBuffer);
        this.parseROM();

        // Fix boss image
        // Test feature: write demon layer data to other scenes, and backup original scene data for restoration
        // Maybe someday I'll figure out where those backup images should be used
        // 0x6A60 ~ 0x6E00
        // 0xEA70 ~ 0xEE10
        let index = 0xEA70;
        let indexEnd = 0xEE10;
        const backupAddr = 0x8C50;

        // If 0x8C50 is all zeros, means no backup has been made
        let needBackup = true;
        for(let i = backupAddr; i < backupAddr + (indexEnd - index); i++){
            if(this.romData[i] !== 0x00){
                needBackup = false;
                break;
            }
        }

        if(needBackup){
            const page1Addr = 0xAA70;
            const page2Addr = 0xCA70;
            for(;index < indexEnd; index++){
                let offset = index - 0xEA70;
                // Backup address
                this.romData[backupAddr + offset] = this.romData[page1Addr + offset];
                // Write new data
                this.romData[page1Addr + offset] = this.romData[index];
                this.romData[page2Addr + offset] = this.romData[index];
            }
        }

        // Fix bug where player dies when reaching max height, using some code space I believe is unused
        const fixedCode = [0x18, 0xA5, 0xC4, 0x65, 0xC8, 0x85, 0xC4, 0xAD, 0x1E, 0x04, 0x65, 0xC7, 0x24, 0xC7, 0x10, 0x06, 0xC9, 0xD5, 0x90, 0x02, 0xA9, 0x00, 0x8D, 0x1E, 0x04, 0x60];
        const codeAddr = 0x19A5;
        for(let i = codeAddr; i< codeAddr + fixedCode.length; i++){
            this.romData[i] = fixedCode[i - codeAddr];
        }
        // If parameters exist, need to load parameter level, then run NES
        
        this.modified = false;
    }

    /**
     * Parse ROM file, read all level data
     */
    parseROM() {
        if (!this.romData) return;

        this.levels = [];
        
        // 0. Read total level count
        this.levelCount = this.romData[Config.LEVEL_COUNT_ADDRESS] - 1;

        // 1. Read address table (little endian)
        const addresses = this.readAddressTable();
        
        // 2. Read monster data address
        const monsterBaseAddress = RomEditor.readMonsterAddress(this.romData);

        // 3. Read each level's data
        let currentMonsterAddr = monsterBaseAddress; // Current monster data read position
        
        for (let i = 0; i < this.levelCount; i++) {
            const startAddr = addresses[i].romAddress;
            const endAddr = (i < this.levelCount - 1) 
                ? addresses[i + 1].romAddress 
                : Config.DATA_START_MAX;

            // Find FF separator
            const dataEnd = this.findSeparator(startAddr, endAddr);
            const data = Array.from(this.romData.slice(startAddr, dataEnd));
            
            // Read monster data, and update next read position
            const monsterResult = this.readMonsterData(currentMonsterAddr);
            const monsterData = monsterResult.data;
            const monsterRomAddress = currentMonsterAddr;
            const monsterCpuAddress = monsterRomAddress - Config.ADDRESS_OFFSET;
            currentMonsterAddr = monsterResult.nextAddress; // Update to next level's monster data address

            const level = new Level(
                i,
                addresses[i].cpuAddress,
                addresses[i].romAddress,
                data,
                monsterData,
                monsterCpuAddress,
                monsterRomAddress
            );

            this.levels.push(level);
        }
    }

    /**
     * Read address table
     * @private
     */
    readAddressTable() {
        const addresses = [];
        
        for (let i = 0; i < this.levelCount; i++) {
            const offset = Config.ADDRESS_TABLE_START + i * 2;
            const lowByte = this.romData[offset];
            const highByte = this.romData[offset + 1];
            const cpuAddress = (highByte << 8) | lowByte;
            const romAddress = cpuAddress + Config.ADDRESS_OFFSET;
            
            addresses.push({ cpuAddress, romAddress });
        }

        return addresses;
    }

    updateLevelAddresses(){
        // Find original start address
        const offset = Config.ADDRESS_TABLE_START + 2;
        const lowByte = this.romData[offset];
        const highByte = this.romData[offset + 1];
        const firstLevelCpuAddress = (highByte << 8) | lowByte;
        const romAddress = firstLevelCpuAddress + Config.ADDRESS_OFFSET;
        for (let i=0; i<this.levels.length; i++){
            if (i===0){
                this.levels[i].updateAddress(
                    firstLevelCpuAddress,
                    romAddress
                );
            }else{
                const prevLevel = this.levels[i-1];
                this.levels[i].updateAddress(
                    prevLevel.cpuAddress + prevLevel.getTotalSize(),
                    prevLevel.romAddress + prevLevel.getTotalSize()
                );
            }
        }
    }

    /**
     * Read monster data address
     * @private
     */
    static readMonsterAddress(romData) {
        const lowByte = romData[Config.MONSTER_ADDRESS_OFFSET];
        const highByte = romData[Config.MONSTER_ADDRESS_OFFSET + 1];
        const cpuAddress = (highByte << 8) | lowByte;
        const romAddress = cpuAddress + Config.ADDRESS_OFFSET;
        return romAddress;
    }

    /**
     * Read single level's monster data
     * @param {number} startAddr - Current level monster data start address
     * @returns {Object} Object containing data and next address
     * @private
     */
    readMonsterData(startAddr) {
        // Read first byte (monster count * 2 + 1)
        const firstByte = this.romData[startAddr];
        
        if (firstByte === 0x01 || firstByte === 0x00) {
            // No monsters, data is only 1 byte
            return {
                data: [firstByte],
                nextAddress: startAddr + 1
            };
        }
        
        // Calculate data length (first byte is data length)
        const dataLength = firstByte;
        const monsterData = Array.from(this.romData.slice(startAddr, startAddr + dataLength));
        
        return {
            data: monsterData,
            nextAddress: startAddr + dataLength
        };
    }

    /**
     * Find FF separator position
     * Note: First 4 bytes cannot be end marker, search from 5th byte
     * @private
     */
    findSeparator(startAddr, endAddr) {
        // Skip first 4 bytes, start searching for FF separator from 5th byte (index startAddr+4)
        for (let j = startAddr + 4; j < endAddr; j++) {
            if (this.romData[j] === 0xFF) {
                return j;
            }
        }
        return endAddr;
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

    /**
     * Recalculate all level addresses
     * @private
     */
    recalculateAddresses(levels) {
        //const firstLevelStart = this.levels[0].romAddress;
        const addresses = this.readAddressTable();
        const firstLevelStart = addresses[0].romAddress;
        let currentPos = firstLevelStart;

        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            const endPos = currentPos + level.getTotalSize();

            // Check boundary
            if (endPos > Config.DATA_START_MAX) {
                return {
                    success: false,
                    //error: `Level data total size exceeds boundary! Level ${i + 1} end address is 0x${endPos.toString(16).toUpperCase()}, exceeds max address 0x7F93. Cannot save!`
                    error: i18n.t('levelDataExceedBoundaryError', {level: i + 1, endAddr: '0x' + endPos.toString(16).toUpperCase(), maxAddr: '0x7F93' })
                };
            }

            // Update address
            const newRomAddress = currentPos;
            const newCpuAddress = newRomAddress - Config.ADDRESS_OFFSET;
            level.updateAddress(newCpuAddress, newRomAddress);

            currentPos = endPos;
        }

        return { success: true };
    }

    updateRomData() {
        this.recalculateAddresses(this.levels);
        RomEditor.writeToROM(this.romData, this.levels, this.levelCount);
    }

    /**
     * Write data to ROM
     * @private
     */
    static writeToROM(romData, levels, levelCount) {
        // 0. Write level count
        romData[Config.LEVEL_COUNT_ADDRESS] = levelCount + 1;
        
        // 1. Update level address table (little endian)
        for (let i = 0; i < levelCount; i++) {
            const offset = Config.ADDRESS_TABLE_START + i * 2;
            const cpuAddr = levels[i].cpuAddress;
            romData[offset] = cpuAddr & 0xFF;           // Low byte
            romData[offset + 1] = (cpuAddr >> 8) & 0xFF; // High byte
        }

        // 3. Write all level data (compact arrangement)
        const firstLevelStart = levels[0].romAddress;
        let writePos = firstLevelStart;
        
        for (let i = 0; i < levelCount; i++) {
            const data = levels[i].data;
            
            // Write data
            for (let j = 0; j < data.length; j++) {
                romData[writePos++] = data[j];
            }
            
            // Write separator FF
            romData[writePos++] = 0xFF;
        }

        // 3. Clear remaining level area
        for (let i = writePos; i < Config.DATA_START_MAX; i++) {
            romData[i] = 0x00;
        }

        // 4. Get monster data base address
        const monsterBaseAddress = RomEditor.readMonsterAddress(romData);
        
        // 5. Write all monster data (in reordered sequence)
        let monsterWritePos = monsterBaseAddress;
        let levelIndex = 0;
        let level1MonsterData = [];
        for (levelIndex = 0; levelIndex < levelCount; levelIndex++) {
            const level = levels[levelIndex];
            const monsterData = level.monsterData;
            
            // Update monster data address
            const monsterRomAddress = monsterWritePos;
            const monsterCpuAddress = monsterRomAddress - Config.ADDRESS_OFFSET;
            level.monsterCpuAddress = monsterCpuAddress;
            level.monsterRomAddress = monsterRomAddress;
            
            // Write monster data
            for (let j = 0; j < monsterData.length; j++) {
                romData[monsterWritePos++] = monsterData[j];
                if(levelIndex === 0){
                    level1MonsterData.push(monsterData[j]);
                }
            }
            level.modified = false;
        }

        // If levelCount < 8, need to modify level 7 and 8 addresses
        // Following non-existent levels all copy first level's monster content
        if(levelIndex < 8){
            for(;levelIndex < 9; levelIndex++){
                for (let j = 0; j < level1MonsterData.length; j++) {
                    romData[monsterWritePos++] = level1MonsterData[j];
                }
            }
        }

        // If level count < 7 or 8, change level 7/8 addresses to first level, otherwise demo mode will freeze
        // Monster addresses also need to point to first level, otherwise unexpected behavior
        if (levelCount < 8){
            const offset8 = Config.ADDRESS_TABLE_START + 7 * 2;
            const cpuAddr = levels[0].cpuAddress;
            romData[offset8] = cpuAddr & 0xFF;
            romData[offset8 + 1] = (cpuAddr >> 8) & 0xFF;
        }

        if(levelCount < 7){
            const offset7 = Config.ADDRESS_TABLE_START + 6 * 2;
            const cpuAddr = levels[0].cpuAddress;
            romData[offset7] = cpuAddr & 0xFF;
            romData[offset7 + 1] = (cpuAddr >> 8) & 0xFF;
        }

        //this.modified = false;
        document.getElementById('writeRomBtn').disabled = true;
        document.getElementById('downloadBtn').disabled = false;
        return romData;
    }

    /**
     * Get ROM data for download
     */
    getROMData() {
        return this.romData;
    }

    /**
     * Is modified
     */
    isModified() {
        return this.modified;
    }

    /**
     * Reorder levels
     * @param {number} fromIndex - Source index
     * @param {number} toIndex - Target index
     */
    reorderLevels(fromIndex, toIndex) {
        if (fromIndex < 0 || fromIndex >= this.levelCount || 
            toIndex < 0 || toIndex >= this.levelCount) {
            return { success: false, error: i18n.t('invalidLevelIndexError') };
        }

        // Move level
        const [movedLevel] = this.levels.splice(fromIndex, 1);
        this.levels.splice(toIndex, 0, movedLevel);

        // Update all level indices
        for (let i = 0; i < this.levelCount; i++) {
            this.levels[i].index = i;
        }

        // Recalculate addresses and write to ROM
        const result = this.recalculateAddresses(this.levels);
        if (!result.success) {
            // If failed, restore original order
            const [restoredLevel] = this.levels.splice(toIndex, 1);
            this.levels.splice(fromIndex, 0, restoredLevel);
            for (let i = 0; i < this.levelCount; i++) {
                this.levels[i].index = i;
            }
            return result;
        }

        //this.writeToROM();
        this.modified = true;

        return { success: true };
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
        if (count < 1 || count > 255) {
            return { success: false, error: i18n.t('setLevelCountError') };
        }
        
        this.levelCount = count; // Actual stored value is 1 more than displayed value
        this.modified = true;
        
        // Write to ROM immediately
        this.romData[Config.LEVEL_COUNT_ADDRESS] = this.levelCount + 1;
        
        return { success: true };
    }
}
