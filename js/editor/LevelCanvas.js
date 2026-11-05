class LevelCanvas {
    /**
     * Render
     */
    static render(editor) {
        if(editor.testMode){
            return;
        }

        // Clear canvas
        // editor.ctx.fillStyle = '#000000';
        // editor.ctx.fillRect(0, 0, editor.canvas.width, editor.canvas.height);
        editor.ctx.clearRect(0, 0, editor.canvas.width, editor.canvas.height);

        if(!editor.isWideScreen){
            // Draw in center of canvas
            editor.ctx.save();
            editor.ctx.translate(editor.canvas.width / 4, 0);
        }

        // 1. Draw background
        if (editor.images.get(GraphicsCatalog.BG)) {
            editor.ctx.drawImage(editor.images.get(GraphicsCatalog.BG), 0, 0, editor.canvas.width / 2, editor.canvas.height);
            if(editor.isWideScreen){
                editor.ctx.drawImage(editor.images.get(GraphicsCatalog.BG), editor.canvas.width / 2, 0, editor.canvas.width / 2, editor.canvas.height);
            }
        }

        // 2. Draw grid (semi-transparent)
        editor.drawGrid();

        // 3. Draw door (2x2 cells, 64x64 pixels)
        if (editor.doorPos && editor.images.get(GraphicsCatalog.DOOR)) {
            editor.ctx.drawImage(
                editor.images.get(GraphicsCatalog.DOOR),
                editor.doorPos.x * EditorGrid.TILE_SIZE,
                editor.doorPos.y * EditorGrid.TILE_SIZE,
                EditorGrid.TILE_SIZE * 2,
                EditorGrid.TILE_SIZE * 2
            );
        }

        // 4. Draw map tiles
        for (let y = 0; y < EditorGrid.GRID_HEIGHT; y++) {
            for (let x = 0; x < EditorGrid.GRID_WIDTH; x++) {
                let tileId = editor.optimizedMapData[y][x];
                if(EditorGrid.DEBUG_MODE){
                    tileId = editor.mapData[y][x];
                }
                const tileName = GraphicsCatalog.TILE_PREFIX + `${tileId}`;
                if (tileId > 0 && editor.images.get(tileName)) {
                    editor.ctx.drawImage(
                        editor.images.get(tileName),
                        x * EditorGrid.TILE_SIZE,
                        y * EditorGrid.TILE_SIZE,
                        EditorGrid.TILE_SIZE,
                        EditorGrid.TILE_SIZE
                    );
                }
            }
        }

        // 5. Draw player
        if (editor.playerPos && editor.images.get(GraphicsCatalog.PLAYER)) {
            editor.ctx.drawImage(
                editor.images.get(GraphicsCatalog.PLAYER),
                editor.playerPos.x * EditorGrid.TILE_SIZE,
                editor.playerPos.y * EditorGrid.TILE_SIZE,
                EditorGrid.TILE_SIZE,
                EditorGrid.TILE_SIZE
            );
        }

        const pairs = [[], [], [], []];
        for (const enemy of editor.enemies) {
            if (enemy.getRealId() === 13) pairs[enemy.getPortalPairId() - 1].push(enemy);
        }
        for (const enemy of editor.enemies) {
            const pair = enemy.getRealId() === 13 && pairs[enemy.getPortalPairId() - 1];
            const exit = pair && pair.length === 2 && pair[1] === enemy;
            LevelCanvas.drawEnemy(enemy, editor.ctx, editor.images, Boolean(editor.mapData[enemy.y]?.[enemy.x]), exit);
        }
        // Pair labels are editor overlays only; A starts as entry, B as exit.
        for (const group of pairs) for (const portal of group) {
            const valid = group.length === 2;
            const label = `${portal.getPortalPairId()}${valid ? (group[0] === portal ? 'A' : 'B') : '?'}`;
            const x = portal.x * EditorGrid.TILE_SIZE, y = portal.y * EditorGrid.TILE_SIZE;
            editor.ctx.save();
            editor.ctx.font = 'bold 11px sans-serif';
            editor.ctx.textAlign = 'left'; editor.ctx.textBaseline = 'top';
            editor.ctx.fillStyle = valid ? 'rgba(0,0,0,0.8)' : '#9b2525';
            editor.ctx.fillRect(x, y, 19, 13);
            editor.ctx.fillStyle = '#fff'; editor.ctx.fillText(label, x + 2, y + 1);
            editor.ctx.restore();
        }

        // If not wide scene, draw mask
        // if(!editor.isWideScreen){
        //     editor.ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
        //     editor.ctx.fillRect(editor.canvas.width / 2, 0, editor.canvas.width / 2, editor.canvas.height);
        // }

        // 7. Draw preview placement box
        if (editor.mouseGridPos && editor.currentTool) {
            editor.drawPreview();
        }

        // Restore canvas drawing boundary
        if(!editor.isWideScreen){
            // Draw in center of canvas
            // Draw boundary
            // Paint black on both sides
            editor.ctx.fillStyle = '#000000';
            editor.ctx.fillRect(-editor.canvas.width / 4, 0, editor.canvas.width / 4, editor.canvas.height);
            editor.ctx.fillRect(editor.canvas.width  / 2, 0, editor.canvas.width / 4, editor.canvas.height);

            editor.ctx.strokeStyle = '#000000';
            editor.ctx.lineWidth = 2;
            editor.ctx.strokeRect(0 , 0, editor.canvas.width / 2, editor.canvas.height);
            editor.ctx.restore();
        }else{
            // Draw boundary
            editor.ctx.strokeStyle = '#000000';
            editor.ctx.lineWidth = 2;
            editor.ctx.strokeRect(0, 0, editor.canvas.width, editor.canvas.height);
        }
    }

    /**
     * Draw grid
     */
    static drawGrid(editor) {
        editor.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        editor.ctx.lineWidth = 1;

        // Vertical lines
        for (let x = 0; x <= EditorGrid.GRID_WIDTH; x++) {
            editor.ctx.beginPath();
            editor.ctx.moveTo(x * EditorGrid.TILE_SIZE, 0);
            editor.ctx.lineTo(x * EditorGrid.TILE_SIZE, editor.canvas.height);
            editor.ctx.stroke();
        }

        // Horizontal lines
        for (let y = 0; y <= EditorGrid.GRID_HEIGHT; y++) {
            editor.ctx.beginPath();
            editor.ctx.moveTo(0, y * EditorGrid.TILE_SIZE);
            editor.ctx.lineTo(editor.canvas.width, y * EditorGrid.TILE_SIZE);
            editor.ctx.stroke();
        }
    }

    /**
     * Draw preview placement box
     */
    static drawPreview(editor) {
        const { x, y } = editor.mouseGridPos;

        // First row prohibits placement, player cannot be placed on second screen
        if (editor.isProhibitedArea(x, y)) {
            // Draw red prohibition box
            editor.ctx.strokeStyle = '#FF0000';
            editor.ctx.lineWidth = 3;
            editor.ctx.strokeRect(
                x * EditorGrid.TILE_SIZE,
                y * EditorGrid.TILE_SIZE,
                EditorGrid.TILE_SIZE,
                EditorGrid.TILE_SIZE
            );

            // Draw prohibition marker
            editor.ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
            editor.ctx.fillRect(
                x * EditorGrid.TILE_SIZE,
                y * EditorGrid.TILE_SIZE,
                EditorGrid.TILE_SIZE,
                EditorGrid.TILE_SIZE
            );

            return;
        }

        // Door is 2x2 cells, needs special handling
        if (editor.currentTool === 'door') {
            const previewY = y - 1;
            // Draw 2x2 highlight box
            editor.ctx.strokeStyle = '#FFD700';
            editor.ctx.lineWidth = 2;
            editor.ctx.strokeRect(
                x * EditorGrid.TILE_SIZE,
                previewY * EditorGrid.TILE_SIZE,
                EditorGrid.TILE_SIZE * 2,
                EditorGrid.TILE_SIZE * 2
            );

            // Draw semi-transparent preview
            editor.ctx.globalAlpha = 0.5;
            if (editor.images.get(GraphicsCatalog.DOOR)) {
                editor.ctx.drawImage(
                    editor.images.get(GraphicsCatalog.DOOR),
                    x * EditorGrid.TILE_SIZE,
                    previewY * EditorGrid.TILE_SIZE,
                    EditorGrid.TILE_SIZE * 2,
                    EditorGrid.TILE_SIZE * 2
                );
            }
            editor.ctx.globalAlpha = 1.0;
        } else if (editor.currentTool === 'enemy' && editor.currentEnemyId) {
            const realId = Enemy.getRealId(editor.currentEnemyId);

            // Enemy preview - draw based on config size
            const enemyName = GraphicsCatalog.ENEMY_PREFIX + `${realId}`;
            const sizeConfig = GraphicsCatalog.RESOURCE_IMG_CONFIG[enemyName];
            const widthInTiles = sizeConfig ? sizeConfig.imgBlockIndex[0].length / 2 : 1;
            const heightInTiles = sizeConfig ? sizeConfig.imgBlockIndex.length / 2 : 1;

            // Tall enemies use bottom as coordinate, preview box should display upward
            const previewY = y - heightInTiles + 1;

            // Draw highlight box
            editor.ctx.strokeStyle = '#FFD700';
            editor.ctx.lineWidth = 2;
            editor.ctx.strokeRect(
                x * EditorGrid.TILE_SIZE,
                previewY * EditorGrid.TILE_SIZE,
                EditorGrid.TILE_SIZE * widthInTiles,
                EditorGrid.TILE_SIZE * heightInTiles
            );
            // Draw semi-transparent preview

            editor.ctx.globalAlpha = 0.5;
            if( x > EditorGrid.GRID_WIDTH / 2 ){
                editor.currentEnemyId = (editor.currentEnemyId | 0x80)
            }else{
                editor.currentEnemyId = (editor.currentEnemyId & 0x7F)

            }

            const facingReverse = realId === 13 || Enemy.getFacing(editor.currentEnemyId);
            // If reversed, draw image reversed

            const group = ((editor.currentEnemyId >> 4) & 3) + 1;
            const exit = realId === 13 && editor.enemies.filter(enemy =>
                enemy.getRealId() === 13 && enemy.getPortalPairId() === group && (enemy.x !== x || enemy.y !== y)).length === 1;
            const portalKey = `enemy_13_pair_${group}${exit ? '_exit' : ''}${editor.mapData[y]?.[x] ? '_covered' : ''}`;
            const img = (realId === 13 && editor.images.get(portalKey)) || editor.images.get(enemyName);

            if (img) {
                if(!facingReverse){
                    editor.ctx.save();
                    editor.ctx.translate((x + widthInTiles) * EditorGrid.TILE_SIZE, 0);
                    editor.ctx.scale(-1, 1);
                    editor.ctx.drawImage(
                        img,
                        0,
                        previewY * EditorGrid.TILE_SIZE,
                        widthInTiles * EditorGrid.TILE_SIZE,
                        heightInTiles * EditorGrid.TILE_SIZE
                    );
                    editor.ctx.restore();
                }else{
                    editor.ctx.drawImage(
                        img,
                        x * EditorGrid.TILE_SIZE,
                        previewY * EditorGrid.TILE_SIZE,
                        EditorGrid.TILE_SIZE * widthInTiles,
                        EditorGrid.TILE_SIZE * heightInTiles
                    );
                }

            }

            editor.ctx.globalAlpha = 1.0;

        } else {

            // Other tools: draw 1x1 highlight box
            editor.ctx.strokeStyle = '#FFD700';
            editor.ctx.lineWidth = 2;
            editor.ctx.strokeRect(
                x * EditorGrid.TILE_SIZE,
                y * EditorGrid.TILE_SIZE,
                EditorGrid.TILE_SIZE,
                EditorGrid.TILE_SIZE
            );

            // Draw semi-transparent preview
            editor.ctx.globalAlpha = 0.5;
            const tileName = GraphicsCatalog.TILE_PREFIX + `${editor.currentTileId}`;
            if (editor.currentTool === 'tile' && editor.currentTileId && editor.images.get(tileName)) {
                editor.ctx.drawImage(
                    editor.images.get(tileName),
                    x * EditorGrid.TILE_SIZE,
                    y * EditorGrid.TILE_SIZE,
                    EditorGrid.TILE_SIZE,
                    EditorGrid.TILE_SIZE
                );
            } else if (editor.currentTool === 'player' && editor.images.get(GraphicsCatalog.PLAYER)) {
                editor.ctx.drawImage(
                    editor.images.get(GraphicsCatalog.PLAYER),
                    x * EditorGrid.TILE_SIZE,
                    y * EditorGrid.TILE_SIZE,
                    EditorGrid.TILE_SIZE,
                    EditorGrid.TILE_SIZE
                );
            }

            editor.ctx.globalAlpha = 1.0;

        }
    }
    static drawEnemy(enemy, ctx, images, covered = false, exit = false){
            let enemyName = GraphicsCatalog.ENEMY_PREFIX + enemy.getRealId();
            let img = images.get(enemyName);
            if (enemy.getRealId() === 13) img = images.get(`enemy_13_pair_${enemy.getPortalPairId()}${exit ? '_exit' : ''}${covered ? '_covered' : ''}`) || img;
            if (img) {
                const sizeConfig = GraphicsCatalog.RESOURCE_IMG_CONFIG[enemyName];
                if (sizeConfig) {
                    const widthInTiles = sizeConfig.imgBlockIndex[0].length / 2;
                    const heightInTiles = sizeConfig.imgBlockIndex.length / 2;

                    // 高个子敌人以底部为坐标，需要向上绘制
                    const drawY = enemy.y - heightInTiles + 1;

                    // 保存当前canvas状态
                    ctx.save();

                    if (enemy.getRealId() !== 13 && !Enemy.getFacing(enemy.enemyId)) {
                        // 镜像绘制：先移动到图像右边缘，然后水平翻转
                        ctx.translate((enemy.x + widthInTiles) * EditorGrid.TILE_SIZE, 0);
                        ctx.scale(-1, 1);

                        // 绘制时x坐标从0开始（因为已经translate了）
                        ctx.drawImage(
                            img,
                            0,
                            drawY * EditorGrid.TILE_SIZE,
                            widthInTiles * EditorGrid.TILE_SIZE,
                            heightInTiles * EditorGrid.TILE_SIZE
                        );
                    } else {
                        // 正常绘制
                        ctx.drawImage(
                            img,
                            enemy.x * EditorGrid.TILE_SIZE,
                            drawY * EditorGrid.TILE_SIZE,
                            widthInTiles * EditorGrid.TILE_SIZE,
                            heightInTiles * EditorGrid.TILE_SIZE
                        );
                    }

                    // 恢复canvas状态
                    ctx.restore();
                }
            }

            if(EditorGrid.DEBUG_MODE){
                // 图片不存在，则绘制红色方框,写上 16进制 敌人id
                ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
                ctx.fillRect(
                    enemy.x * EditorGrid.TILE_SIZE,
                    enemy.y * EditorGrid.TILE_SIZE,
                    EditorGrid.TILE_SIZE,
                    EditorGrid.TILE_SIZE
                );
                ctx.fillStyle = '#000';
                ctx.font = '12px Arial';
                ctx.fillText(
                    enemy.enemyId.toString(16).toUpperCase().padStart(2, '0'),
                    enemy.x * EditorGrid.TILE_SIZE + 8,
                    enemy.y * EditorGrid.TILE_SIZE + 20
                );
            }
    }

}
