class OptimizedMap{
    static optimizedMap(bgId, mapData, optimizedMapData, isWideScreen = false){
        const bgIdNum = parseInt(bgId, 10);
        const mapWidth = isWideScreen
            ? Config.GRID_WIDTH
            : Config.GRID_WIDTH / 2;
        switch(bgIdNum){
            case 0x00:
                OptimizedMap.optimizeMap00(mapData, optimizedMapData);
                break;
            case 0x01:
                OptimizedMap.optimizeMap01(mapData, optimizedMapData);
                break;
            case 0x02:
                OptimizedMap.optimizeMap02(mapData, optimizedMapData);
                break;
            case 0x03:
                OptimizedMap.optimizeMap03(mapData, optimizedMapData);
                break;
            case 0x04:
                OptimizedMap.optimizeMap04(mapData, optimizedMapData);
                break;
            case 0x05:
                OptimizedMap.optimizeMap05(mapData, optimizedMapData, mapWidth);
                break;
            case 0x06:
                OptimizedMap.optimizeMap06(mapData, optimizedMapData);
                break;
            case 0x07:
                OptimizedMap.optimizeMap07(mapData, optimizedMapData);
                break;
            case 0x08:
                OptimizedMap.optimizeMap08(mapData, optimizedMapData);
                break;
            case 0x09:
                OptimizedMap.optimizeMap09(mapData, optimizedMapData, mapWidth);
                break;
            case 0x0A:
                OptimizedMap.optimizeMap10(mapData, optimizedMapData, mapWidth);
                break;
            case 0x0B:
                OptimizedMap.optimizeMap11(mapData, optimizedMapData);
                break;
            default:
                OptimizedMap.default(mapData, optimizedMapData);
                break;
        }
    }
    static default(mapData, optimizedMap){
        for(let y=0; y<Config.GRID_HEIGHT; y++){
            for(let x=0; x<Config.GRID_WIDTH; x++){
                optimizedMap[y][x] = mapData[y][x];
            }
        }
    }

    static optimizeMap00(mapData, optimizedMap){
        //OptimizedMap.default(mapData, optimizedMap);
        for(let y=0; y<Config.GRID_HEIGHT; y++){
            for(let x=0; x<Config.GRID_WIDTH; x++){
                let tile = mapData[y][x];
                if([1, 2, 3].includes(tile)){
                    const topTile = (y > 0) ? mapData[y - 1][x] : 0;
                    const bottomTile = (y < Config.GRID_HEIGHT - 1) ? mapData[y + 1][x] : 0;
                    //如果 tile 是 3 号，则判断上下是否有 3号，如果有则保留 
                    // 如果没有 判断 下面的 tile 是否是 1 ~ 2 号，如果有 则为 1 号
                    if(tile === 3){
                        if(![3].includes(topTile) || ![3].includes(bottomTile)){
                            if([1, 2].includes(bottomTile)){
                                tile = 1;
                            }else{
                                tile = 2;
                            }
                        }
                    }else{
                    //如果上面 有， 则为 1 号
                        if([1, 2, 3].includes(bottomTile)){
                            tile = 1;
                        }else{
                            tile = 2;
                        }
                    }
                }

                optimizedMap[y][x] = tile;
            }
        }
    }

    static optimizeMap01(mapData, optimizedMap){
        //OptimizedMap.default(mapData, optimizedMap);
        for(let y=0; y<Config.GRID_HEIGHT; y++){
            for(let x=0; x<Config.GRID_WIDTH; x++){
                let tile = mapData[y][x];
                if([1, 2, 3].includes(tile)){
                    const topTile = (y > 0) ? mapData[y - 1][x] : 0;
                    const bottomTile = (y < Config.GRID_HEIGHT - 1) ? mapData[y + 1][x] : 0;
                    //如果 tile 是 3 号，则判断上下是否有 3号，如果有则保留 
                    // 如果没有 判断 下面的 tile 是否是 1 ~ 2 号，如果有 则为 1 号
                    if(tile === 3){
                        if(![3].includes(topTile) || ![3].includes(bottomTile)){
                            if([1, 2].includes(bottomTile)){
                                tile = 1;
                            }else{
                                tile = 2;
                            }
                        }
                    }else{
                    //如果上面 有， 则为 1 号
                        if([1, 2, 3].includes(bottomTile)){
                            tile = 1;
                        }else{
                            tile = 2;
                        }
                    }
                }

                optimizedMap[y][x] = tile;                
            }
        }
    }

    static optimizeMap02(mapData, optimizedMap){
        OptimizedMap.default(mapData, optimizedMap);
    }

    static optimizeMap03(mapData, optimizedMap){
        //OptimizedMap.default(mapData, optimizedMap);
        for(let y=0; y<Config.GRID_HEIGHT; y++){
            //
            for(let x=0; x<Config.GRID_WIDTH; x++){
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
        OptimizedMap.default(mapData, optimizedMap);
        for(let y=0; y<Config.GRID_HEIGHT; y++){
            for(let x=0; x<Config.GRID_WIDTH; x++){
                let tile = mapData[y][x];
                // 如果 tile 上下都有，则变为 1号，
                // 如果 tile 上下都没有， 则变为 2号
                if([1, 2, 3].includes(tile)){
                    const topTile = (y > 0) ? mapData[y - 1][x] : 0;
                    const bottomTile = (y < Config.GRID_HEIGHT - 1) ? mapData[y + 1][x] : 0;
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

    static optimizeMap05(mapData, optimizedMap, mapWidth = Config.GRID_WIDTH){
        for(let y=0; y<Config.GRID_HEIGHT; y++){
            const row = Array.isArray(mapData[y]) ? mapData[y] : [];
            // Single-screen rows have 16 cells and wide-screen rows have 32.
            // Both modes wrap horizontally, so the row edges are neighbours.
            const rowWidth = Math.min(mapWidth, Config.GRID_WIDTH);
            //
            for(let x=0; x<Config.GRID_WIDTH; x++){
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
        for(let y=0; y<Config.GRID_HEIGHT; y++){
            for(let x=0; x<Config.GRID_WIDTH; x++){
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
        for(let y=0; y<Config.GRID_HEIGHT; y++){
            for(let x=0; x<Config.GRID_WIDTH; x++){
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
        OptimizedMap.optimizeMap07(mapData, optimizedMap);
    }

    static optimizeMap09(mapData, optimizedMap, mapWidth){
        OptimizedMap.optimizeMap05(mapData, optimizedMap, mapWidth);
    }

    static optimizeMap10(mapData, optimizedMap, mapWidth){
        OptimizedMap.optimizeMap05(mapData, optimizedMap, mapWidth);
    }

    static optimizeMap11(mapData, optimizedMap){
        for(let y=0; y<Config.GRID_HEIGHT; y++){
            for(let x=0; x<Config.GRID_WIDTH; x++){
                let tile = mapData[y][x];
                if([1, 2, 3].includes(tile)){
                    tile = 4;
                }
                optimizedMap[y][x] = tile;
            }
        }
    }
}
