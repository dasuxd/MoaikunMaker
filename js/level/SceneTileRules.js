class SceneTileRules{
    static optimizedMap(bgId, mapData, optimizedMapData, isWideScreen = false){
        const bgIdNum = parseInt(bgId, 10);
        const mapWidth = isWideScreen
            ? EditorGrid.GRID_WIDTH
            : EditorGrid.GRID_WIDTH / 2;
        switch(bgIdNum){
            case 0x00:
                SceneTileRules.optimizeMap00(mapData, optimizedMapData);
                break;
            case 0x01:
                SceneTileRules.optimizeMap01(mapData, optimizedMapData);
                break;
            case 0x02:
                SceneTileRules.optimizeMap02(mapData, optimizedMapData);
                break;
            case 0x03:
                SceneTileRules.optimizeMap03(mapData, optimizedMapData);
                break;
            case 0x04:
                SceneTileRules.optimizeMap04(mapData, optimizedMapData);
                break;
            case 0x05:
                SceneTileRules.optimizeMap05(mapData, optimizedMapData, mapWidth);
                break;
            case 0x06:
                SceneTileRules.optimizeMap06(mapData, optimizedMapData);
                break;
            case 0x07:
                SceneTileRules.optimizeMap07(mapData, optimizedMapData);
                break;
            case 0x08:
                SceneTileRules.optimizeMap08(mapData, optimizedMapData);
                break;
            case 0x09:
                SceneTileRules.optimizeMap09(mapData, optimizedMapData, mapWidth);
                break;
            case 0x0A:
                SceneTileRules.optimizeMap10(mapData, optimizedMapData, mapWidth);
                break;
            case 0x0B:
                SceneTileRules.optimizeMap11(mapData, optimizedMapData);
                break;
            default:
                SceneTileRules.default(mapData, optimizedMapData);
                break;
        }
    }
    static default(mapData, optimizedMap){
        for(let y=0; y<EditorGrid.GRID_HEIGHT; y++){
            for(let x=0; x<EditorGrid.GRID_WIDTH; x++){
                optimizedMap[y][x] = mapData[y][x];
            }
        }
    }

    /**
     * Rebuild an editable source map from tiles already stored in ROM.
     *
     * Backgrounds 0 and 1 are not idempotent: optimizing their saved output
     * again shortens Tile 3 columns. For those backgrounds, find a source
     * column whose first optimization produces the saved column exactly.
     * Other backgrounds can use the saved tiles directly.
     */
    static createEditableMap(bgId, optimizedMap){
        const editableMap = optimizedMap.map(row => [...row]);
        const bgIdNum = parseInt(bgId, 10);
        if(bgIdNum !== 0x00 && bgIdNum !== 0x01){
            return editableMap;
        }

        const mapWidth = editableMap.reduce(
            (width, row) => Math.max(width, Array.isArray(row) ? row.length : 0),
            0
        );
        for(let x = 0; x < mapWidth; x++){
            if(!editableMap.every(row => Array.isArray(row) && x < row.length)){
                continue;
            }
            const savedColumn = editableMap.map(row => row[x]);
            const sourceColumn = SceneTileRules.restoreMap00Column(savedColumn);
            if(!sourceColumn){
                continue;
            }
            for(let y = 0; y < sourceColumn.length; y++){
                editableMap[y][x] = sourceColumn[y];
            }
        }
        return editableMap;
    }

    /**
     * Find one source column that maps to an already optimized column.
     * The optimizer only depends on the tile above and below, so a small
     * dynamic-programming search avoids guessing how saved cap tiles began.
     */
    static restoreMap00Column(savedColumn){
        if(!Array.isArray(savedColumn) || savedColumn.length === 0){
            return [];
        }

        const autoTiles = [1, 2, 3];
        const candidatesFor = tile => autoTiles.includes(tile) ? autoTiles : [tile];
        let states = candidatesFor(savedColumn[0]).map(tile => ({
            topTile: 0,
            tile,
            source: [tile]
        }));

        for(let y = 0; y < savedColumn.length; y++){
            const bottomCandidates = y < savedColumn.length - 1
                ? candidatesFor(savedColumn[y + 1])
                : [0];
            const nextStates = new Map();

            for(const state of states){
                for(const bottomTile of bottomCandidates){
                    const optimizedTile = SceneTileRules.optimizeMap00Tile(
                        state.tile,
                        state.topTile,
                        bottomTile
                    );
                    if(optimizedTile !== savedColumn[y]){
                        continue;
                    }
                    if(y === savedColumn.length - 1){
                        return state.source;
                    }

                    const key = `${state.tile}:${bottomTile}`;
                    if(!nextStates.has(key)){
                        nextStates.set(key, {
                            topTile: state.tile,
                            tile: bottomTile,
                            source: [...state.source, bottomTile]
                        });
                    }
                }
            }
            states = [...nextStates.values()];
            if(states.length === 0){
                return null;
            }
        }
        return null;
    }

    static optimizeMap00Tile(tile, topTile, bottomTile){
        if(![1, 2, 3].includes(tile)){
            return tile;
        }
        if(tile === 3){
            if(topTile !== 3 || bottomTile !== 3){
                return [1, 2].includes(bottomTile) ? 1 : 2;
            }
            return tile;
        }
        return [1, 2, 3].includes(bottomTile) ? 1 : 2;
    }

    static optimizeMap00(mapData, optimizedMap){
        //SceneTileRules.default(mapData, optimizedMap);
        for(let y=0; y<EditorGrid.GRID_HEIGHT; y++){
            for(let x=0; x<EditorGrid.GRID_WIDTH; x++){
                let tile = mapData[y][x];
                if([1, 2, 3].includes(tile)){
                    const topTile = (y > 0) ? mapData[y - 1][x] : 0;
                    const bottomTile = (y < EditorGrid.GRID_HEIGHT - 1) ? mapData[y + 1][x] : 0;
                    tile = SceneTileRules.optimizeMap00Tile(tile, topTile, bottomTile);
                }

                optimizedMap[y][x] = tile;
            }
        }
    }

    static optimizeMap01(mapData, optimizedMap){
        //SceneTileRules.default(mapData, optimizedMap);
        for(let y=0; y<EditorGrid.GRID_HEIGHT; y++){
            for(let x=0; x<EditorGrid.GRID_WIDTH; x++){
                let tile = mapData[y][x];
                if([1, 2, 3].includes(tile)){
                    const topTile = (y > 0) ? mapData[y - 1][x] : 0;
                    const bottomTile = (y < EditorGrid.GRID_HEIGHT - 1) ? mapData[y + 1][x] : 0;
                    tile = SceneTileRules.optimizeMap00Tile(tile, topTile, bottomTile);
                }

                optimizedMap[y][x] = tile;                
            }
        }
    }

    static optimizeMap02(mapData, optimizedMap){
        SceneTileRules.default(mapData, optimizedMap);
    }

    static optimizeMap03(mapData, optimizedMap){
        //SceneTileRules.default(mapData, optimizedMap);
        for(let y=0; y<EditorGrid.GRID_HEIGHT; y++){
            //
            for(let x=0; x<EditorGrid.GRID_WIDTH; x++){
                let tile = mapData[y][x];
                // 示例优化规则：所有 1 、 2 、3 号砖块
                // 如果两边都没有砖块 则变为 4 号砖块
                // 如果左边有右边没有则变成  3 号砖块
                // 如果右边有左边没有则变成 1 号砖块
                // 如果左右都有 则变成 2 号砖块

                if(tile === 1 || tile === 2 || tile ===3){
                    //如果上面没有一个1、2、3 则为 1号
                    //如果上面有一个 则为 2号
                    //如果上面有两个以上则为 3号
                    const topTile = (y > 0) ? mapData[y - 1][x] : 0;
                    const topTopTile = (y > 1) ? mapData[y - 2][x] : 0;
                    tile = 1
                    if([1, 2, 3].includes(topTile)){
                        tile = 2;
                        if([1, 2, 3].includes(topTopTile)){
                            tile = 3;
                        }
                    }
                }
                optimizedMap[y][x] = tile;
            }
        }
    }

    static optimizeMap04(mapData, optimizedMap){
        SceneTileRules.default(mapData, optimizedMap);
        for(let y=0; y<EditorGrid.GRID_HEIGHT; y++){
            for(let x=0; x<EditorGrid.GRID_WIDTH; x++){
                let tile = mapData[y][x];
                // 如果 tile 上下都有，则变为 1号，
                // 如果 tile 上下都没有， 则变为 2号
                if([1, 2, 3].includes(tile)){
                    const topTile = (y > 0) ? mapData[y - 1][x] : 0;
                    const bottomTile = (y < EditorGrid.GRID_HEIGHT - 1) ? mapData[y + 1][x] : 0;
                    if([1, 2, 3].includes(topTile)){
                        tile = 1;
                    }else{
                        tile = 2;
                    }
                }
                optimizedMap[y][x] = tile;
            }
        }
    }

    static optimizeMap05(mapData, optimizedMap, mapWidth = EditorGrid.GRID_WIDTH){
        for(let y=0; y<EditorGrid.GRID_HEIGHT; y++){
            const row = Array.isArray(mapData[y]) ? mapData[y] : [];
            // Single-screen rows have 16 cells and wide-screen rows have 32.
            // Both modes wrap horizontally, so the row edges are neighbours.
            const rowWidth = Math.min(mapWidth, EditorGrid.GRID_WIDTH);
            //
            for(let x=0; x<EditorGrid.GRID_WIDTH; x++){
                let tile = row[x] ?? 0;
                // 示例优化规则：所有 1 、 2 、3 号砖块
                // 如果两边都没有砖块 则变为 4 号砖块
                // 如果左边有右边没有则变成  3 号砖块
                // 如果右边有左边没有则变成 1 号砖块
                // 如果左右都有 则变成 2 号砖块

                if((tile === 1 || tile === 2 || tile ===3) && rowWidth > 0 && x < rowWidth){
                    const leftTile = row[(x - 1 + rowWidth) % rowWidth] ?? 0;
                    const rightTile = row[(x + 1) % rowWidth] ?? 0;
                    if(![1, 2, 3].includes(leftTile) && ![1, 2, 3].includes(rightTile)){
                        tile = 4;
                    }else if([1, 2, 3].includes(leftTile) && ![1, 2, 3].includes(rightTile)){
                        tile =3;
                    }else if(![1, 2, 3].includes(leftTile) && [1, 2, 3].includes(rightTile)){
                        tile =1;
                    }else{
                        tile =2;
                    }
                }  
                optimizedMap[y][x] = tile;
            }
        }
    }

    static optimizeMap06(mapData, optimizedMap){
        for(let y=0; y<EditorGrid.GRID_HEIGHT; y++){
            for(let x=0; x<EditorGrid.GRID_WIDTH; x++){
                let tile = mapData[y][x];
                // 如果 tile 上下都有，则变为 1号，
                // 如果 tile 上下都没有， 则变为 2号
                if([1, 2, 3].includes(tile)){
                    tile = 4;
                }
                optimizedMap[y][x] = tile;
            }
        }
    }

    static optimizeMap07(mapData, optimizedMap){
        for(let y=0; y<EditorGrid.GRID_HEIGHT; y++){
            for(let x=0; x<EditorGrid.GRID_WIDTH; x++){
                let tile = mapData[y][x];
                // 如果 tile 上下都有，则变为 1号，
                // 如果 tile 上下都没有， 则变为 2号
                if([3].includes(tile)){
                    tile = 1;
                }
                optimizedMap[y][x] = tile;
            }
        }
    }

    static optimizeMap08(mapData, optimizedMap){
        SceneTileRules.optimizeMap07(mapData, optimizedMap);
    }

    static optimizeMap09(mapData, optimizedMap, mapWidth){
        SceneTileRules.optimizeMap05(mapData, optimizedMap, mapWidth);
    }

    static optimizeMap10(mapData, optimizedMap, mapWidth){
        SceneTileRules.optimizeMap05(mapData, optimizedMap, mapWidth);
    }

    static optimizeMap11(mapData, optimizedMap){
        for(let y=0; y<EditorGrid.GRID_HEIGHT; y++){
            for(let x=0; x<EditorGrid.GRID_WIDTH; x++){
                let tile = mapData[y][x];
                if([1, 2, 3].includes(tile)){
                    tile = 4;
                }
                optimizedMap[y][x] = tile;
            }
        }
    }
}

function checkConsecutiveMoai(mapData, isWideScreen) {
    let rows = EditorGrid.GRID_HEIGHT;
    let cols = isWideScreen ? EditorGrid.GRID_WIDTH : EditorGrid.GRID_WIDTH / 2;
    let consecutiveCount = 0;
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const tileId = mapData[y][x];
            if(tileId === 0xF) {
                consecutiveCount++;
                if (consecutiveCount >= 0xF) {
                    return false;
                }
            }else{
                consecutiveCount = 0;
            }

        }
    }
    return true;
}
