/**
 * ROM 编辑器类
 * 负责加载、解析、修改和保存 ROM 文件
 */

//笔记 1号 普通  2号 速度怪  3号垃圾桶  4、原地转圈怪 5、蝙蝠  7、围绕转圈怪 【boss 某些关卡】 8、吐刀怪   9、垃圾桶2  10、吐刀怪
class RomEditor {
    constructor() {
        this.romData = null;
        this.levels = [];
        this.palettes = [];
        this.modified = false;
        
        // 当前关卡总数
        this.levelCount = 56;
    }

    /**
     * 加载 ROM 文件
     * @param {ArrayBuffer} arrayBuffer - ROM 文件的 ArrayBuffer
     */
    loadROM(arrayBuffer) {
        this.romData = new Uint8Array(arrayBuffer);
        this.parseROM();

        //修复 boss 图像
        //测试功能，将魔王图层数据写入其他场景，并备份其他场景的原本数据。方便恢复
        //0x6A60 ~ 0x6E00
        //0xEA70 ~ 0xEE10
        let index = 0xEA70;
        let indexEnd = 0xEE10;
        const backupAddr = 0x8C50;

        //如果0x8C50 全是0则代表没有备份过
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
                //备份地址
                this.romData[backupAddr + offset] = this.romData[page1Addr + offset];
                //写入新数据
                this.romData[page1Addr + offset] = this.romData[index];
                this.romData[page2Addr + offset] = this.romData[index];
            }
        }

        //修复最高度过高玩家会死亡得bug问题 ---- 算了，估计原作者也是改来改去解决不了，才留下了空余的空间
        //const fixedCode = [0x18, 0xA5, 0xC4, 0x65, 0xC8, 0x85, 0xC4, 0xAD, 0x1E, 0x04, 0xAA, 0x18, 0x65, 0xC7, 0xE0, 0x09, 0xB0, 0x06, 0x24, 0xC7, 0x10, 0x02, 0x90, 0x03, 0x8D, 0x1E, 0x04, 0x60]
        //const fixedCode = [0x18, 0xA5, 0xC40, 0x65, 0xC8, 0x85, 0xC4, 0x08, 0xAD, 0x1E, 0x04, 0xC9, 0x09, 0xB0, 0x04, 0x24, 0xC7, 0x30, 0x07, 0x28, 0x65, 0xC7, 0x8D, 0x1E, 0x04, 0x60, 0x28, 0x60]
        //const orgCode = [0x18, 0xA5, 0xC4, 0x65, 0xC8, 0x85, 0xC4, 0xAD, 0x1E, 0x04, 0x65, 0xC7, 0x8D, 0x1E, 0x04, 0x60, 0x38, 0xA9, 0x00, 0xE5, 0xC6, 0x85, 0xC6, 0xA9, 0x00, 0xE5, 0xC5, 0x85, 0xC5, 0x60]
        // const orgCode = [
        //     0x18, 0xA5, 0xC4, 0x65, 0xC8, 0x85, 0xC4, 0xAD, 0x1E, 0x04, 0x65, 0xC7, 0x8D, 0x1E, 0x04, 0x60, 
        //     0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
        // const codeAddr = 0x19A5;
        // for(let i = codeAddr; i< codeAddr + fixedCode.length; i++){
        //     this.romData[i] = fixedCode[i - codeAddr];
        // }
        //如果存在参数，则需要加载参数关卡，然后 让 nes 运行
        
        this.modified = false;
    }

    /**
     * 解析 ROM 文件，读取所有关卡数据
     */
    parseROM() {
        if (!this.romData) return;

        this.levels = [];
        
        // 0. 读取关卡总数
        this.levelCount = this.romData[Config.LEVEL_COUNT_ADDRESS] - 1;

        // 1. 读取地址表（小端序）
        const addresses = this.readAddressTable();
        
        // 2. 读取怪物数据地址
        const monsterBaseAddress = RomEditor.readMonsterAddress(this.romData);

        // 3. 读取每个关卡的数据
        let currentMonsterAddr = monsterBaseAddress; // 当前怪物数据读取位置
        
        for (let i = 0; i < this.levelCount; i++) {
            const startAddr = addresses[i].romAddress;
            const endAddr = (i < this.levelCount - 1) 
                ? addresses[i + 1].romAddress 
                : Config.DATA_START_MAX;

            // 查找 FF 分隔符
            const dataEnd = this.findSeparator(startAddr, endAddr);
            const data = Array.from(this.romData.slice(startAddr, dataEnd));
            
            // 读取怪物数据，并更新下一个读取位置
            const monsterResult = this.readMonsterData(currentMonsterAddr);
            const monsterData = monsterResult.data;
            const monsterRomAddress = currentMonsterAddr;
            const monsterCpuAddress = monsterRomAddress - Config.ADDRESS_OFFSET;
            currentMonsterAddr = monsterResult.nextAddress; // 更新为下一个关卡的怪物数据地址

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
     * 读取地址表
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
        //找到原起始地址
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
     * 读取怪物数据地址
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
     * 读取单个关卡的怪物数据
     * @param {number} startAddr - 当前关卡怪物数据的起始地址
     * @returns {Object} 包含数据和下一个地址的对象
     * @private
     */
    readMonsterData(startAddr) {
        // 读取第一个字节（怪物数量 * 2 + 1）
        const firstByte = this.romData[startAddr];
        
        if (firstByte === 0x01 || firstByte === 0x00) {
            // 没有怪物，数据只有1个字节
            return {
                data: [firstByte],
                nextAddress: startAddr + 1
            };
        }
        
        // 计算数据长度（第一个字节就是数据长度）
        const dataLength = firstByte;
        const monsterData = Array.from(this.romData.slice(startAddr, startAddr + dataLength));
        
        return {
            data: monsterData,
            nextAddress: startAddr + dataLength
        };
    }

    /**
     * 查找 FF 分隔符位置
     * 注意：前4个字节不能作为结束标记，从第5个字节开始查找
     * @private
     */
    findSeparator(startAddr, endAddr) {
        // 跳过前4个字节，从第5个字节（索引startAddr+4）开始查找FF分隔符
        for (let j = startAddr + 4; j < endAddr; j++) {
            if (this.romData[j] === 0xFF) {
                return j;
            }
        }
        return endAddr;
    }

    /**
     * 获取关卡
     * @param {number} index - 关卡索引
     */
    getLevel(index) {
        return this.levels[index];
    }

    /**
     * 获取所有关卡
     */
    getAllLevels() {
        return this.levels;
    }

    /**
     * 计算所有关卡的地图大小
     */
    calculateTotalSize() {
        return this.levels.reduce((total, level) => total + level.getTotalSize(), 0);
    }

    /**
     * 检查是否会超出边界
     * @param {number} levelIndex - 要修改的关卡索引
     * @param {number} newSize - 新的数据大小
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
     * 重新计算所有关卡的地址
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

            // 检查边界
            if (endPos > Config.DATA_START_MAX) {
                return {
                    success: false,
                    //error: `关卡数据总大小超出边界！第 ${i + 1} 关的结束地址为 0x${endPos.toString(16).toUpperCase()}，超过最大地址 0x7F93。无法保存！`
                    error: i18n.t('levelDataExceedBoundaryError', {level: i + 1, endAddr: '0x' + endPos.toString(16).toUpperCase(), maxAddr: '0x7F93' })
                };
            }

            // 更新地址
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
     * 将数据写入 ROM
     * @private
     */
    static writeToROM(romData, levels, levelCount) {
        // 0. 写入关卡总数
        romData[Config.LEVEL_COUNT_ADDRESS] = levelCount + 1;
        
        // 1. 更新关卡地址表（小端序）
        for (let i = 0; i < levelCount; i++) {
            const offset = Config.ADDRESS_TABLE_START + i * 2;
            const cpuAddr = levels[i].cpuAddress;
            romData[offset] = cpuAddr & 0xFF;           // 低字节
            romData[offset + 1] = (cpuAddr >> 8) & 0xFF; // 高字节
        }

        // 3. 写入所有关卡数据（紧凑排列）
        const firstLevelStart = levels[0].romAddress;
        let writePos = firstLevelStart;
        
        for (let i = 0; i < levelCount; i++) {
            const data = levels[i].data;
            
            // 写入数据
            for (let j = 0; j < data.length; j++) {
                romData[writePos++] = data[j];
            }
            
            // 写入分隔符 FF
            romData[writePos++] = 0xFF;
        }

        // 3. 清空剩余关卡区域
        for (let i = writePos; i < Config.DATA_START_MAX; i++) {
            romData[i] = 0x00;
        }

        // 4. 获取怪物数据基地址
        const monsterBaseAddress = RomEditor.readMonsterAddress(romData);
        
        // 5. 写入所有怪物数据（按重新排序后的顺序）
        let monsterWritePos = monsterBaseAddress;
        let levelIndex = 0;
        let level1MonsterData = [];
        for (levelIndex = 0; levelIndex < levelCount; levelIndex++) {
            const level = levels[levelIndex];
            const monsterData = level.monsterData;
            
            // 更新怪物数据地址
            const monsterRomAddress = monsterWritePos;
            const monsterCpuAddress = monsterRomAddress - Config.ADDRESS_OFFSET;
            level.monsterCpuAddress = monsterCpuAddress;
            level.monsterRomAddress = monsterRomAddress;
            
            // 写入怪物数据
            for (let j = 0; j < monsterData.length; j++) {
                romData[monsterWritePos++] = monsterData[j];
                if(levelIndex === 0){
                    level1MonsterData.push(monsterData[j]);
                }
            }
            level.modified = false;
        }

        //如果levelCount小于 8，则需要修改第七八关地址
        //则后续不存在的关卡全部复制第一关的怪物内容
        if(levelIndex < 8){
            for(;levelIndex < 9; levelIndex++){
                for (let j = 0; j < level1MonsterData.length; j++) {
                    romData[monsterWritePos++] = level1MonsterData[j];
                }
            }
        }

        //如果关书小于 七八，将第七第八关地址改为第一关地址，否则演示模式会卡死
        // 怪物地址也要指向第一关，否则会出意外
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

    getTmpRomData(){

    }

    /**
     * 获取 ROM 数据用于下载
     */
    getROMData() {
        return this.romData;
    }

    /**
     * 是否已修改
     */
    isModified() {
        return this.modified;
    }

    /**
     * 重新排序关卡
     * @param {number} fromIndex - 源索引
     * @param {number} toIndex - 目标索引
     */
    reorderLevels(fromIndex, toIndex) {
        if (fromIndex < 0 || fromIndex >= this.levelCount || 
            toIndex < 0 || toIndex >= this.levelCount) {
            return { success: false, error: i18n.t('invalidLevelIndexError') };
        }

        // 移动关卡
        const [movedLevel] = this.levels.splice(fromIndex, 1);
        this.levels.splice(toIndex, 0, movedLevel);

        // 更新所有关卡的索引
        for (let i = 0; i < this.levelCount; i++) {
            this.levels[i].index = i;
        }

        // 重新计算地址并写入ROM
        const result = this.recalculateAddresses(this.levels);
        if (!result.success) {
            // 如果失败，恢复原顺序
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
     * 获取关卡总数
     */
    getLevelCount() {
        return this.levelCount;
    }
    
    /**
     * 设置关卡总数
     * @param {number} count - 关卡总数
     */
    setLevelCount(count) {
        if (count < 1 || count > 255) {
            return { success: false, error: i18n.t('setLevelCountError') };
        }
        
        this.levelCount = count; // 实际存储值比显示值多1
        this.modified = true;
        
        // 立即写入ROM
        this.romData[Config.LEVEL_COUNT_ADDRESS] = this.levelCount + 1;
        
        return { success: true };
    }

    // static saveLevelToROM(romData, level, levelIndex) {
    //     // 计算关卡起始地址
    //     const addresses = [];
    //     for (let i = 0; i < levelIndex; i++) {
    //         const offset = Config.ADDRESS_TABLE_START + i * 2;
    //         const lowByte = romData[offset];
    //         const highByte = romData[offset + 1];
    //         const cpuAddress = (highByte << 8) | lowByte;
    //         const romAddress = cpuAddress + Config.ADDRESS_OFFSET;
    //         addresses.push(romAddress);
    //     }

    //     const startAddr = Config.ADDRESS_TABLE_START + levelIndex * 2;
    //     const levelAddr = (romData[startAddr + 1] << 8) | romData[startAddr];
    //     const levelRomAddr = levelAddr + Config.ADDRESS_OFFSET;


    //     // 写入关卡数据
    //     let writePos = startAddr;
    //     const data = level.data;
    // }
}
