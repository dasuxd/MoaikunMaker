class Enemy{
    constructor(enemyId, x, y){
        // enemyId 编码格式（十六进制）：
        // 例如：0x48 = 72(十进制) = 0100 1000(二进制)
        // bit 7: 屏幕索引；bit 6: 朝向。
        // bit 5-4: 传送门配对编号 (0-3)；bit 3-0: 角色ID (0-15)。
        this.enemyId = enemyId;
        
        // 使用掩码解析enemyId
        //this.id = enemyId & 0x0F;  // 低4位：角色ID (掩码 0000 1111)
        // 根据屏幕索引调整x坐标
        // 第二个屏幕的敌人需要偏移半个网格宽度
        this.x = x;
        this.y = y;
    }

    reverseFacing(){
        if (this.getRealId() === 13) {
            this.enemyId = (this.enemyId & 0xCF) | (((this.enemyId + 0x10) & 0x30));
            return;
        }
        // 切换朝向：翻转bit 6 (0x40掩码)
        this.enemyId ^= 0x40;  // XOR操作翻转朝向位
    }

    getRealId(){
        return this.enemyId & 0x0F;
    }

    getPortalPairId(){
        return ((this.enemyId >> 4) & 3) + 1;
    }

    static getRealId(enemyId){
        // 使用掩码获取低4位：角色ID
        return enemyId & 0x0F;
    }

    static getFacing(enemyId){
        //return ((enemyId & 0x40) === 0x40) ^ ((enemyId & 0x80) === 0x80);  // 异或操作
        return !((enemyId & 0x40) === 0x40);  // 异或操作
    }

    static getScreenIndex(enemyId){
        // 使用掩码检查bit 7：屏幕索引
        return (enemyId & 0x80) === 0x80 ? 1 : 0;
    }
}
