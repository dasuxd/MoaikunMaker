/**
 * 关卡数据类
 * 负责管理单个关卡的数据和地址信息
 */
class Level {
    /**
     * @param {number} index - 关卡索引（0-55）
     * @param {number} cpuAddress - CPU 地址
     * @param {number} romAddress - ROM 文件地址
     * @param {Array<number>} data - 关卡数据字节数组
     * @param {Array<number>} monsterData - 怪物数据字节数组
     * @param {number} monsterCpuAddress - 怪物数据CPU地址
     * @param {number} monsterRomAddress - 怪物数据ROM地址
     */
    constructor(index, cpuAddress, romAddress, data = [], monsterData = [0x01], monsterCpuAddress = 0, monsterRomAddress = 0) {
        this.index = index;
        this.originalIndex = index; // 记录原始索引
        this.cpuAddress = cpuAddress;
        this.romAddress = romAddress;
        this.data = data;
        this.monsterData = monsterData;
        this.monsterCpuAddress = monsterCpuAddress;
        this.monsterRomAddress = monsterRomAddress;
        this.dragged = false; // 标记是否被拖拽过

        //是否修改过
        this.modified = false;
        //是否已经保存
        //this.saved = false;
    }

    /**
     * 获取关卡编号（从1开始）
     */
    getLevelNumber() {
        return this.index + 1;
    }

    /**
     * 获取数据大小（字节数）
     */
    getDataSize() {
        return this.data.length;
    }

    /**
     * 获取包含分隔符的总大小
     */
    getTotalSize() {
        return this.data.length + 1; // +1 for FF separator
    }

    /**
     * 获取十六进制格式的数据字符串
     */
    getHexString() {
        return this.data.map(b => 
            b.toString(16).toUpperCase().padStart(2, '0')
        ).join(' ');
    }

    /**
     * 获取怪物数据的十六进制字符串
     */
    getMonsterHexString() {
        return this.monsterData.map(b => 
            b.toString(16).toUpperCase().padStart(2, '0')
        ).join(' ');
    }

    /**
     * 从十六进制字符串设置数据
     * @param {string} hexString - 十六进制字符串（空格分隔）
     * @returns {boolean} 是否成功
     */
    saveMapData(mapData) {
        const hexString = mapData.map(b => 
            b.toString(16).toUpperCase().padStart(2, '0')
        ).join(' ');

        const hexBytes = hexString.trim().split(/\s+/).filter(s => s.length > 0);
        
        // 验证十六进制格式
        for (let hex of hexBytes) {
            if (!/^[0-9A-Fa-f]{1,2}$/.test(hex)) {
                return false;
            }
        }

        // 转换为字节数组
        this.data = hexBytes.map(h => parseInt(h, 16));
        return true;
    }

    /**
     * 从十六进制字符串设置怪物数据
     * @param {Array<number>} monsterData - 怪物数据字节数组
     * @returns {Object} 结果对象
     */
    saveMonsterData(monsterData) {
        const monsterHexString = monsterData.map(b => 
                b.toString(16).toUpperCase().padStart(2, '0')
            ).join(' ');
        const hexBytes = monsterHexString.trim().split(/\s+/).filter(s => s.length > 0);
        
        if (hexBytes.length === 0) {
            return { success: false, error: i18n.t("emptyEnemyDataError") };
        }
        
        // 验证十六进制格式
        for (let hex of hexBytes) {
            if (!/^[0-9A-Fa-f]{1,2}$/.test(hex)) {
                return { success: false, error: i18n.t("invalidHexValue",{hexValue: hex}) };
            }
        }

        // 转换为字节数组
        const newData = hexBytes.map(h => parseInt(h, 16));
        
        // 验证第一个字节
        const firstByte = newData[0];
        if (firstByte === 0x01) {
            // 没有怪物的情况
            if (newData.length !== 1) {
                return { success: false, error: '当第一个字节为01时，不应有其他数据' };
            }
        } else {
            // 有怪物的情况，验证数据长度
            if (firstByte !== newData.length) {
                return { success: false, error: `第一个字节表示数据长度为 ${firstByte}，但实际数据长度为 ${newData.length}` };
            }
            
            // 验证数据长度是否为奇数（第一个字节 + 怪物对数*2）
            if (firstByte % 2 === 0) {
                return { success: false, error: '数据长度应该是奇数（怪物数量 * 2 + 1）' };
            }
        }
        
        this.monsterData = newData;
        return { success: true };
    }

    /**
     * 更新关卡地址
     * @param {number} cpuAddress - 新的 CPU 地址
     * @param {number} romAddress - 新的 ROM 地址
     */
    updateAddress(cpuAddress, romAddress) {
        this.cpuAddress = cpuAddress;
        this.romAddress = romAddress;
    }

    /**
     * 克隆关卡数据
     */
    clone() {
        const cloned = new Level(
            this.index,
            this.cpuAddress,
            this.romAddress,
            [...this.data],
            [...this.monsterData],
            this.monsterCpuAddress,
            this.monsterRomAddress
        );
        cloned.originalIndex = this.originalIndex;
        cloned.dragged = this.dragged;
        return cloned;
    }


    /**
     * 获取格式化的ROM地址字符串
     */
    getRomAddressString() {
        return `0x${this.romAddress.toString(16).toUpperCase()}`;
    }

    /**
     * 获取格式化的CPU地址字符串
     */
    getCpuAddressString() {
        return `0x${this.cpuAddress.toString(16).toUpperCase()}`;
    }

    /**
     * 获取怪物数据ROM地址字符串
     */
    getMonsterRomAddressString() {
        return `0x${this.monsterRomAddress.toString(16).toUpperCase()}`;
    }

    /**
     * 获取怪物数据CPU地址字符串
     */
    getMonsterCpuAddressString() {
        return `0x${this.monsterCpuAddress.toString(16).toUpperCase()}`;
    }

    /**
     * 获取原始关卡编号（从1开始）
     */
    getOriginalLevelNumber() {
        return this.originalIndex + 1;
    }

    /**
     * 是否被拖拽过
     */
    isDragged() {
        return this.dragged;
    }

    /**
     * 标记为已拖拽
     */
    markAsDragged() {
        this.dragged = true;
    }
}
