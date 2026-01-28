class OptimizedMap{
    static optimizedMap(bgId, mapData, optimizedMapData){
        const bgIdNum = parseInt(bgId, 10);
        switch(bgIdNum){
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
                OptimizedMap.optimizeMap05(mapData, optimizedMapData);
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
                OptimizedMap.optimizeMap09(mapData, optimizedMapData);
                break;
            case 0x0A:
                OptimizedMap.optimizeMap10(mapData, optimizedMapData);
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
    static optimizeMap01(mapData, optimizedMap){
        OptimizedMap.default(mapData, optimizedMap);
    }

    static optimizeMap02(mapData, optimizedMap){
        OptimizedMap.default(mapData, optimizedMap);
    }

    static optimizeMap03(mapData, optimizedMap){
        OptimizedMap.default(mapData, optimizedMap);
    }

    static optimizeMap04(mapData, optimizedMap){
        OptimizedMap.default(mapData, optimizedMap);
    }

    static optimizeMap05(mapData, optimizedMap){
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
                    const leftTile = (x > 0) ? mapData[y][x - 1] : 0;
                    const rightTile = (x < Config.GRID_WIDTH - 1) ? mapData[y][x + 1] : 0;
                    if(![1, 2, 3].includes(leftTile) && ![1, 2, 3].includes(rightTile)){
                        optimizedMap[y][x] = 4;
                    }else if([1, 2, 3].includes(leftTile) && ![1, 2, 3].includes(rightTile)){
                        optimizedMap[y][x] =3;
                    }else if(![1, 2, 3].includes(leftTile) && [1, 2, 3].includes(rightTile)){
                        optimizedMap[y][x] =1;
                    }else{
                        optimizedMap[y][x] =2;
                    }
                }else{
                    optimizedMap[y][x] = tile;
                }
            }
        }
    }

    static optimizeMap06(mapData, optimizedMap){
        OptimizedMap.default(mapData, optimizedMap);
    }

    static optimizeMap07(mapData, optimizedMap){
        OptimizedMap.default(mapData, optimizedMap);
    }

    static optimizeMap08(mapData, optimizedMap){
        OptimizedMap.default(mapData, optimizedMap);
    }

    static optimizeMap09(mapData, optimizedMap){
        OptimizedMap.optimizeMap05(mapData, optimizedMap);
    }

    static optimizeMap10(mapData, optimizedMap){
        OptimizedMap.optimizeMap05(mapData, optimizedMap);
    }

    static optimizeMap11(mapData, optimizedMap){
        OptimizedMap.default(mapData, optimizedMap);
    }
}