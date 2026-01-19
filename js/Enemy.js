class Enemy{
    constructor(enemyId, x, y){
        // enemyId 编码格式（十六进制）：
        // 例如：0x48 = 72(十进制) = 0100 1000(二进制)
        // 高4位(bit 7-4): 屏幕索引 (0=第一屏, 8=第二屏，对应二进制的bit 7)
        // 低4位中的bit 6: 朝向 (0=正常, 1=反向，即0x40)
        // 低4位中的bit 3-0: 角色ID (0-15)
        this.enemyId = enemyId;
        
        // 使用掩码解析enemyId
        //this.id = enemyId & 0x0F;  // 低4位：角色ID (掩码 0000 1111)
        // 根据屏幕索引调整x坐标
        // 第二个屏幕的敌人需要偏移半个网格宽度
        this.x = x;
        this.y = y;
    }

    reverseFacing(){
        // 切换朝向：翻转bit 6 (0x40掩码)
        this.enemyId ^= 0x40;  // XOR操作翻转朝向位
    }

    render(ctx, images){
            let enemyName = Config.ENEMY_PREFIX + this.getRealId();
            let img = images.get(enemyName);
            if (img) {
                const sizeConfig = Config.RESOURCE_IMG_CONFIG[enemyName];
                if (sizeConfig) {
                    const widthInTiles = sizeConfig.imgBlockIndex[0].length / 2;
                    const heightInTiles = sizeConfig.imgBlockIndex.length / 2;
                    
                    // 高个子敌人以底部为坐标，需要向上绘制
                    const drawY = this.y - heightInTiles + 1;
                    
                    // 保存当前canvas状态
                    ctx.save();
                    
                    if (!Enemy.getFacing(this.enemyId)) {
                        // 镜像绘制：先移动到图像右边缘，然后水平翻转
                        ctx.translate((this.x + widthInTiles) * Config.TILE_SIZE, 0);
                        ctx.scale(-1, 1);
                        
                        // 绘制时x坐标从0开始（因为已经translate了）
                        ctx.drawImage(
                            img,
                            0,
                            drawY * Config.TILE_SIZE,
                            widthInTiles * Config.TILE_SIZE,
                            heightInTiles * Config.TILE_SIZE
                        );
                    } else {
                        // 正常绘制
                        ctx.drawImage(
                            img,
                            this.x * Config.TILE_SIZE,
                            drawY * Config.TILE_SIZE,
                            widthInTiles * Config.TILE_SIZE,
                            heightInTiles * Config.TILE_SIZE
                        );
                    }
                    
                    // 恢复canvas状态
                    ctx.restore();
                }
            }

            if(Config.DEBUG_MODE){
                // 图片不存在，则绘制红色方框,写上 16进制 敌人id
                ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
                ctx.fillRect(
                    this.x * Config.TILE_SIZE,
                    this.y * Config.TILE_SIZE,
                    Config.TILE_SIZE,
                    Config.TILE_SIZE
                );
                ctx.fillStyle = '#000';
                ctx.font = '12px Arial';
                ctx.fillText(
                    this.enemyId.toString(16).toUpperCase().padStart(2, '0'),
                    this.x * Config.TILE_SIZE + 8,
                    this.y * Config.TILE_SIZE + 20
                );
            }
    }

    getRealId(){
        return this.enemyId & 0x0F;
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