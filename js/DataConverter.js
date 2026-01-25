/**
 * 数据转换工具类
 * 在ROM编辑器和可视化编辑器之间转换数据格式
 */
class DataConverter {
    constructor() {
    }

    /**
     * 从ROM关卡数据解析为可视化编辑器格式
     * @param {Array<number>} mapData - ROM关卡的地图数据（不含FF分隔符）
     * @param {Array<number>} monsterData - ROM关卡的怪物数据
     * @returns {Object} {background, player, door, map, enemies}
     */
    static fromROMtoEditor(mapData, monsterData) {
        // 1. 解析地图数据的第一个字节（背景ID）
        const background = mapData[0];
        
        //const hexBgId = background.toString(16).padStart(2, '0');
        let isWideScreen = ((background & 0x10) === 0x10);
        // 还有一种是 isWideScreen 为 false 但是 第一位却有值的bug screen
        let isBugScreen = (background & 0xE0) !== 0;
        const bgId = (background & 0x0F).toString();

        // 2. 解析玩家位置（第二个字节）
        const playerByte = mapData[1];
        const player = playerByte > 0 ? {
            x: Math.floor(playerByte / 16),
            y: playerByte % 16
        } : null;
        
        // 3. 解析门的位置（第三、四个字节）
        const doorX = mapData[2];
        const doorY = mapData[3];
        const door = (doorX > 0 || doorY > 0) ? { x: doorX, y: doorY } : null;
        
        // 4. 解析地图tile数据（从第5个字节开始，RLE编码）
        const map = DataConverter.decodeRLEMap(mapData.slice(4), isWideScreen, isBugScreen);
        
        // 5. 解析怪物数据
        const enemies = DataConverter.decodeMonsterData(monsterData);
        
        return {
            background: bgId,
            isWideScreen: isWideScreen,
            isBugScreen: isBugScreen,
            player,
            door,
            map,
            enemies
        };
    }

    /**
     * 从关卡编辑器格式转换为ROM格式
     * @param {Object} levelEditorData - {background, player, door, map, enemies}
     * @returns {Object} {mapData, monsterData}
     */
    static fromLevelEditorToROMData(levelEditorData, isWideScreen) {
        const mapBytes = [];
        
        // 1. 背景ID
        // 将背景ID从10进制字符串转换为16进制
        mapBytes.push(levelEditorData.background);
        
        // 2. 玩家位置
        if (levelEditorData.player) {
            mapBytes.push(levelEditorData.player.x * 16 + levelEditorData.player.y);
        } else {
            mapBytes.push(0x00);
        }
        
        // 3. 门的X坐标
        if (levelEditorData.door) {
            mapBytes.push(levelEditorData.door.x);
        } else {
            mapBytes.push(0x00);
        }
        
        // 4. 门的Y坐标
        if (levelEditorData.door) {
            mapBytes.push(levelEditorData.door.y);
        } else {
            mapBytes.push(0x00);
        }
        
        // 5. 地图数据（RLE编码）
        const rleBytes = DataConverter.encodeRLEMap(levelEditorData.map, isWideScreen);
        mapBytes.push(...rleBytes);
        
        // 6. 怪物数据
        const monsterBytes = DataConverter.encodeMonsterData(levelEditorData.enemies);
        
        return {
            mapData: mapBytes,
            monsterData: monsterBytes
        };
    }

    /**
     * 解码RLE地图数据为二维数组
     * @param {Array<number>} rleData - RLE编码的数据
     * @returns {Array<Array<number>>} 16x14的二维数组
     */
    static decodeRLEMap(rleData, isWideScreen, isBugScreen) {
        let gridWidth = Config.GRID_WIDTH;
        if(!(isWideScreen || isBugScreen)){
            gridWidth = Config.GRID_WIDTH / 2;
        }
        const map = Array(Config.GRID_HEIGHT).fill(null).map(() => Array(gridWidth).fill(0));
        
        let position = 0;
        for (const byte of rleData) {
            const count = ((byte >> 4) & 0x0F) + 1;
            const tileId = byte & 0x0F;
            
            for (let i = 0; i < count; i++) {
                const x = position % gridWidth;


                const y = Math.floor(position / gridWidth);
                
                if (y < Config.GRID_HEIGHT) {
                    map[y][x] = tileId;
                }
                
                position++;
            }
        }
        
        return map;
    }

    /**
     * 编码二维数组为RLE格式
     * @param {Array<Array<number>>} map - 16x14的二维数组
     * @returns {Array<number>} RLE编码的字节数组
     */
    static encodeRLEMap(map, isWideScreen) {
        const bytes = [];
        const flatMap = [];

        // 展平二维数组
        for (let y = 0; y < Config.GRID_HEIGHT; y++) {
            let gridWidth = Config.GRID_WIDTH;
            if(!isWideScreen){
                gridWidth = Config.GRID_WIDTH / 2;
            }
            for (let x = 0; x < gridWidth; x++) {
                flatMap.push(map[y][x]);
            }
        }
        
        // RLE编码
        let i = 0;

        //地图末尾的 0x00 不进行编码，直接丢弃
        const tmpBytes = [];
        while (i < flatMap.length) {
            const currentTile = flatMap[i];
            let count = 1;
            if(currentTile === 0){
                while (i + count < flatMap.length && 
                    flatMap[i + count] === currentTile && 
                    count < 16) {
                    count++;
                }
                
                const encodedByte = ((count - 1) << 4) | (currentTile & 0x0F);
                tmpBytes.push(encodedByte);
                
                i += count;
            }else{
                // 对于非0的tile，正常编码
                bytes.push(...tmpBytes);
                tmpBytes.length = 0;
                while (i + count < flatMap.length && 
                    flatMap[i + count] === currentTile && 
                    count < 16) {
                    count++;
                }
                
                const encodedByte = ((count - 1) << 4) | (currentTile & 0x0F);
                bytes.push(encodedByte);
                
                i += count;
            }

        }
        
        return bytes;
    }

    /**
     * 解码怪物数据
     * @param {Array<number>} monsterData - 怪物数据字节数组
     * @returns {Array<Object>} [{id, x, y}, ...]
     */
    static decodeMonsterData(monsterData) {
        if (!monsterData || monsterData.length === 0) {
            return [];
        }
        
        const enemies = [];
        const firstByte = monsterData[0];
        
        if (firstByte === 0x01 || firstByte === 0x00) {
            return [];
        }
        
        // 解析怪物数据
        for (let i = 1; i < monsterData.length; i += 2) {
            if (i + 1 < monsterData.length) {
                const id = monsterData[i];
                const position = monsterData[i + 1];
                const x = Math.floor(position / 16);
                const y = position % 16;
                
                enemies.push({ id, x, y });
            }
        }
        
        return enemies;
    }

    /**
     * 编码怪物数据
     * @param {Array<Object>} enemies - [{id, x, y}, ...]
     * @returns {Array<number>} 怪物数据字节数组
     */
    static encodeMonsterData(enemies) {
        const bytes = [];
        
        // 如果没有敌人或敌人数组为空，返回 [0x01]
        if (!enemies || enemies.length === 0) {
            bytes.push(0x01);
            return bytes;
        }
        
        // 第一个字节：怪物数量 * 2 + 1
        const firstByte = enemies.length * 2 + 1;
        bytes.push(firstByte);
        
        // 添加每个怪物的数据
        for (const enemy of enemies) {
            let x = enemy.x;

            if(enemy.x >= Config.GRID_WIDTH / 2){
                enemy.enemyId = (enemy.enemyId | 0x80); // 设置高4位的bit 7为1，表示第二屏
                x = enemy.x - Config.GRID_WIDTH / 2;
            }
            bytes.push(enemy.enemyId);
            bytes.push(x * 16 + enemy.y);
        }
        
        return bytes;
    }
}
