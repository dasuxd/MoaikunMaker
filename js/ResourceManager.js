class ResourceManager{
    static instance = null;

    constructor() {
        this.images = new Map();
        this.romImages = new Map();
        this.romLevelTypeImg = [];
        this.palettes = [];
        this.bgImgs = [];
        
    }

    static getInstance(){
        if(!ResourceManager.instance){
            ResourceManager.instance = new ResourceManager();
        }
        return ResourceManager.instance;
    }

    async initResources(romData){
        //初始化
        this.images = new Map();
        this.romImages = new Map();
        this.romLevelTypeImg = [];
        this.palettes = [];
        this.bgImgs = [];
        
        //加载调色板
        this.loadPalettes(romData);
        
        // 并行加载背景图片和资源，等待都完成后继续

        await Promise.all([
            await this.loadBgImg(romData),
            await this.loadBgResources(romData),
            app.selectLevel(0)
        ]);
        
        // 所有资源加载完成后可以在这里添加逻辑
        console.log('所有背景图片和资源加载完成');
    }

    getResource(levelType, resourceKey){
        //let levelType = parseInt(bgId);
        if(this.romLevelTypeImg[levelType] === undefined){{
            return null;
        }}
        return this.romLevelTypeImg[levelType].get(resourceKey);
    }

    async parseRomImgSync(romData, imgInfo, colorStyle, levelType, metatileoffset){
        // 存储解析后的图像数据
        this.parsedImages = [];

        // 计算基地址
        let baseAddr = imgInfo.isSprite ? 0xA010 : 0xA010 + 0x1000;

        if(levelType === 5 || levelType === 6 || levelType === 9 || levelType ===10|| levelType ===11){
            baseAddr += 0x2000;
        }else if(levelType === 7 || levelType === 8 || levelType === 0xD){
            baseAddr += 0x4000;
        }


        // 遍历 imgBlockIndex 获取 tile 索引
        const flattenedTiles = [];
        for(let row = 0; row < imgInfo.imgBlockIndex.length; row++){
            for(let col = 0; col < imgInfo.imgBlockIndex[row].length; col++){
                flattenedTiles.push(imgInfo.imgBlockIndex[row][col]);
            }
        }

        // 解析每个 tile
        for(let tileIndex = 0; tileIndex < flattenedTiles.length; tileIndex++){
            const tileInfo = flattenedTiles[tileIndex];
            const tileAddr = baseAddr + ((tileInfo.index + metatileoffset * 2) * 0x10);
            
            // 创建 8x8 像素数组
            const tilePixels = [];
            
            // 解析 8 行像素
            for(let row = 0; row < 8; row++){
                const bitplane0 = romData[tileAddr + row];     // 低位平面
                const bitplane1 = romData[tileAddr + row + 8]; // 高位平面
                
                const rowPixels = [];
                
                // 解析 8 列像素（从高位到低位）
                for(let col = 0; col < 8; col++){
                    const bitPos = tileInfo.reverse ? col : (7 - col); // 如果反转，从低位到高位
                    const bit0 = (bitplane0 >> bitPos) & 1;
                    const bit1 = (bitplane1 >> bitPos) & 1;
                    const colorIndex = (bit1 << 1) | bit0; // 组合成 0-3 的颜色索引
                    
                    rowPixels.push({
                        colorIndex: colorIndex,
                        color: colorStyle
                    });
                }
                
                tilePixels.push(rowPixels);
            }
            
            this.parsedImages.push({
                tileIndex: tileIndex,
                address: tileAddr,
                pixels: tilePixels
            });
        }

        // 计算宽度和高度（单位：tile）
        const heightTiles = imgInfo.imgBlockIndex.length;
        const widthTiles = imgInfo.imgBlockIndex[0].length;

        // 组合成最终图像
        const combinedImage = [];
        for(let row = 0; row < heightTiles; row++){
            for(let pixcelRow = 0; pixcelRow < 8; pixcelRow++){
                let combineCol = []
                for(let col = 0; col < widthTiles; col++){
                    let pixcels = this.parsedImages[row * widthTiles + col].pixels;
                    // pixcels 是 8x8 的二维数组，先取当前行，再遍历该行的每个像素
                    const rowPixels = pixcels[pixcelRow];
                    for(let pixelsIndex = 0; pixelsIndex < rowPixels.length; pixelsIndex++){
                        const pixel = rowPixels[pixelsIndex];
                        combineCol.push({color: pixel.color[pixel.colorIndex]});
                    }
                }
                combinedImage.push(combineCol);
            }
        }

        // 创建 canvas 并绘制图像
        const width = widthTiles * 8;
        const height = heightTiles * 8;
        return await this.createImage(combinedImage, width, height, true);
    }

    async createImage(pixcels, width, height, isTransparent = false){
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        
        // 绘制每个像素
        for(let y = 0; y < height; y++){
            for(let x = 0; x < width; x++){
                const pixel = pixcels[y][x];
                if(!pixel){
                    debugger;
                }
                
                // 跳过完全透明的像素（颜色格式为 #RRGGBB00）
                let color = pixel.color;
                if(isTransparent && color.endsWith('00')) {
                    continue; // 不绘制透明像素，保持 canvas 背景透明
                }else{
                    color = color.slice(0, 7) + 'FF'; // 确保不透明
                }
                
                ctx.fillStyle = color;
                ctx.fillRect(x, y, 1, 1);
            }
        }
        
        // 将 canvas 转换为 Image 对象，使用 PNG 格式保留透明度
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = canvas.toDataURL('image/png'); // 明确指定 PNG 格式
        });
    }

    //调色板
    loadPalettes(romData){
        //0xD63D   -> 0x564D
        //const levelType = 3;
        for(let i = 0; i < Config.LEVEL_TYPE_COUNT; i++){
            const offset = i * 2;
            const nameTableTypeAddr = app.romEditor.getRomAddrByOriginalRomAddr(Config.PALETTES_ADDRESS_ORIGINAL + offset);

            let dataAddr = romData[nameTableTypeAddr + 1] * 0x100 + romData[nameTableTypeAddr];
            dataAddr = app.romEditor.getRomAddressFromOriginalCpuAddress(dataAddr);
            
            const newPalette = [];
            for(let j = 0; j < 0x20; j++){
                const nesColorIndex = romData[dataAddr + j];
                // 每组4个颜色的第一个设为透明色
                const isTransparent = (j % 4 === 0);
                let rgbHex = this.nesColorToHex(nesColorIndex, isTransparent);
                newPalette.push(rgbHex);
            }

            this.palettes.push(newPalette);
            
            // 输出调色板信息用于验证
            //console.log(`关卡类型 ${i} 调色板:`, newPalette);
        }

    }

    /**
     * 将 NES 调色板索引转换为十六进制 RGB 字符串
     * @param {number} nesIndex - NES 调色板索引 (0-63)
     * @param {boolean} isTransparent - 是否设置为透明色
     * @returns {string} RGBA 十六进制字符串，格式如 "#FF00EEFF"
     */
    nesColorToHex(nesIndex, isTransparent = false) {
        // 确保索引在有效范围内
        const index = nesIndex & 0x3F; // 只取低6位，范围 0-63
        
        const rgb = Config.NES_PALETTE[index];
        const r = rgb[0].toString(16).padStart(2, '0').toUpperCase();
        const g = rgb[1].toString(16).padStart(2, '0').toUpperCase();
        const b = rgb[2].toString(16).padStart(2, '0').toUpperCase();
        const a = isTransparent ? '00' : 'FF'; // 透明或不透明
        
        return `#${r}${g}${b}${a}`;
    }

    async loadBgResources(romData){
        const parseRomImg = (romData, imgInfo , colorStyle, levelType, metatileoffset) => {
            return new Promise((resolve, reject) => {
                try {
                    // 执行异步操作
                    const result = this.parseRomImgSync(romData, imgInfo, colorStyle, levelType, metatileoffset);
                    resolve(result);  // 成功时调用
                } catch(error) {
                    reject(error);  // 失败时调用
                }
            });
        };

       for(let levelType = 0; levelType < Config.LEVEL_TYPE_COUNT; levelType++){
            const levelImgs = new Map();
            levelImgs.set('bg', this.bgImgs[levelType]);
            //加载颜色配置
            const offset = levelType * 4;
            const colorConfig = app.romEditor.getRomAddrByOriginalRomAddr(0x3FF4 + offset);
            const colorIndex = [];
            //取出16个元素对应的色盘
            for(let i = 0; i < 4; i++){
                const byte = romData[colorConfig + i];
                colorIndex.push((byte >> 6) & 0x03);
                colorIndex.push((byte >> 4) & 0x03);
                colorIndex.push((byte >> 2) & 0x03);
                colorIndex.push((byte >> 0) & 0x03);
            }
            for(let key in Config.RESOURCE_IMG_CONFIG){
                let itemConfig = Config.RESOURCE_IMG_CONFIG[key];
                let palette = this.palettes[levelType];
                let color = []

                let metatileoffset = 0;
                if(itemConfig.isSprite || key === 'enemy_9' || key === 'door'){
                    if(key === 'player'){
                        color = palette.slice(16,  20);
                    }else if(key === 'door'){
                        color = palette.slice(24,  28);
                    }else{
                        color = palette.slice(20,  24);
                    }
                    
                }else{
                    let index = parseInt(key.split("_")[1]);
                    if(index){
                        color = palette.slice(colorIndex[index] * 4, colorIndex[index] * 4 + 4);
                        //TODO
                        // scene 4 offset in game should be 14
                        // scene 6 offset in game shoule be XX  I think it's a discarded design in original game
                        //
                        
                        if(index < 4){
                            if(levelType === 0){
                                metatileoffset = 4;
                            }else if(levelType === 2){
                                metatileoffset = 8;
                            }else if(levelType === 3){
                                metatileoffset = 12;
                            }else if(levelType === 4){
                                metatileoffset = 16;
                            }else if(levelType === 6){
                                metatileoffset = -9;
                            }else if(levelType === 11){
                                metatileoffset = 4;
                            }
                        }
                    }else{
                        color = palette.slice(0,  4);
                    }
                    
                }

                let img = await parseRomImg(romData, itemConfig, color, levelType, metatileoffset);
                levelImgs.set(key, img);
            }

            this.romLevelTypeImg.push(levelImgs);
        }
    }

    async loadBgImg(romData){
        //const bgImgs = [];
        const bgDatas = this.loadBgData(romData);
        //图片地址 (CHR ROM 的起始地址)
        const imgAddrStartAddr = 0xB010;
        
        // 渲染所有关卡类型的背景
        for(let i = 0; i < Config.LEVEL_TYPE_COUNT; i++){
            let imgPageAddr = imgAddrStartAddr;
            if(i === 5 || i === 6 || i === 9 || i ===10|| i ===11){
                imgPageAddr += 0x2000;
            }else if(i === 7 || i === 8 || i === 0xD){
                imgPageAddr += 0x4000;
            }
            const bgImg = this.renderBgImage(romData, bgDatas[i], imgPageAddr);
             
            // 等待图片创建完成
            const img = await this.createImage(bgImg.pixels, bgImg.width, bgImg.height);
            this.bgImgs.push(img);
            //console.log(`第${i}号关卡类型背景已渲染`);
        }
        //console.log('所有背景图片加载完成');
    }

    loadBgData(romData){
        const bgDatas = [];
        for(let levelType=0; levelType < Config.LEVEL_TYPE_COUNT; levelType++){
            
            //1、先将小块拼成4 X4 大块。
            //2、再将大块按 index 拼成最终背景图。
            //3、将最终结果绘制到 canvas 上，生成图片，并保存到 img
            const combineTiles = this.loadTileIndex(romData, levelType);
            const bgCombineData = this.loadCombineData(romData, levelType);
            // 加载背景颜色属性
            const bgAttributeData = this.loadBgAttributeData(romData, bgCombineData, levelType);
            //const palette = this.loadPalette(romData, levelType);
            const palette = this.palettes[levelType];

            // combineTiles 为 16 个 4X4 的数组。
            // 其中 bgCombineData 存放的是combineTiles中数据的 index。 每个数据占4X4个小块。
            // 现在需要将 bgCombineData 的index换成 真实数据，真实数据应当为 32 * 28 个数据。
            const bgData = [];

            // 遍历 bgCombineData 的每一行（7行）
            for(let combineRow = 0; combineRow < bgCombineData.length; combineRow++){
                const combineRowData = bgCombineData[combineRow]; // 一行有8个 combineTile 索引
                
                // 每个 combineTile 有4行，所以需要展开成4行
                for(let innerRow = 0; innerRow < 4; innerRow++){
                    const bgDataRow = [];
                    
                    // 遍历这一行的8个 combineTile
                    for(let combineCol = 0; combineCol < combineRowData.length; combineCol++){
                        const tileIndex = combineRowData[combineCol]; // 获取 combineTile 索引
                        
                        // 检查索引是否有效
                        if(tileIndex >= 0 && tileIndex < combineTiles.length){
                            const tile = combineTiles[tileIndex]; // 获取 4×4 的 tile 数据
                            
                            // 将这个 tile 的第 innerRow 行的4个元素添加到当前行
                            if(tile && tile[innerRow]){
                                bgDataRow.push(...tile[innerRow]);
                            } else {
                                // 如果数据不存在，填充4个0
                                bgDataRow.push(0, 0, 0, 0);
                            }
                        } else {
                            // 索引无效，填充4个0
                            bgDataRow.push(0, 0, 0, 0);
                        }
                    }
                    
                    bgData.push(bgDataRow);
                }
            }
            
            bgDatas.push({
                levelType: levelType,
                bgData: bgData,
                bgAttributeData: bgAttributeData,
                palette: palette,
            });
        }
        return bgDatas;
    }

    loadBgAttributeData(romData, bgCombineData, levelType){
        const bgAttributeAddrAddr = app.romEditor.getRomAddrByOriginalRomAddr(0x4CE2 + levelType * 2);
        let bgAttributeAddr = romData[bgAttributeAddrAddr + 1] * 0x100 + romData[bgAttributeAddrAddr];
        //bgAttributeAddr = bgAttributeAddr - 0x8000 + 0x0010;
        bgAttributeAddr = app.romEditor.getRomAddressFromOriginalCpuAddress(bgAttributeAddr);

        //一个字节对应一块大块 所以应该是 8 * 7 = 56 个字节
        //const bgAttributeData = [0xF];
        // 将 romData[colorDataAddr] 之后的16 个值放入bgAttributeData；
        const indexColor = romData.slice(bgAttributeAddr, bgAttributeAddr + 0xf);
        const bgAttributeData = new Array(32 * 28).fill(0);
        //const lineNum = 8 * 4;
        for(let j = 0; j < 7; j++){
            for(let i = 0; i < 8; i++){
                //const colorDataAddr = bgAttributeAddr + i + j * 8;
                //let colorData = romData[colorDataAddr];
                const tileIndex = bgCombineData[j][i];
                let colorData = indexColor[tileIndex];
                let tile1Index = colorData & 0x03;
                let tile2Index = (colorData >> 2) & 0x03;
                let tile3Index = (colorData >> 4) & 0x03;
                let tile4Index = (colorData >> 6) & 0x03;
                //为4 * 4 个tile 配置颜色
                for(let m = 0; m < 4; m++){
                    for(let n = 0; n < 4; n++){
                        let tileIndex = j * 8 * 4 * 4  + i * 4  + m * 4 * 8 + n;
                        //bgAttributeData[tileIndex] = tile1Index;
                        if(m < 2 && n < 2){
                            bgAttributeData[tileIndex] = tile1Index;
                        }else if(m < 2 && n >=2){
                            bgAttributeData[tileIndex] = tile2Index;
                        }else if(m >=2 && n <2){
                            bgAttributeData[tileIndex] = tile3Index;
                        }else{
                            bgAttributeData[tileIndex] = tile4Index;
                        }
                    }
                }
            }
        }

        //整理成 32 X 28 的数据
        const finalBgAttributeData = [];
        for(let row = 0; row < 28; row++){
            const rowData = [];
            for(let col = 0; col < 32; col++){
                const tileIndex = row * 32 + col;
                rowData.push(bgAttributeData[tileIndex]);
            }
            finalBgAttributeData.push(rowData);
        }
        return finalBgAttributeData;
    }

    loadCombineData(romData, levelType){
        //0xCAD2 0xCAF2(0x4B02) 0809 + Y关卡类型偏移地址 负责将大块拼成背景
        //const bgAddrAddr = 0x4AE2 + levelType * 2;
        const bgAddrAddr = app.romEditor.getRomAddrByOriginalRomAddr(0x4AE2 + levelType * 2);
        let bgAddr = romData[bgAddrAddr + 1] * 0x100 + romData[bgAddrAddr];
        //bgAddr = bgAddr - 0x8000 + 0x0010;
        bgAddr = app.romEditor.getRomAddressFromOriginalCpuAddress(bgAddr);

        let valueWidth = 4;
        if(levelType === 0x07 || levelType === 0x08 || levelType === 0x0D){
            valueWidth = 8;
        }
        // 读取 4 * 7 = 56 个字节的背景数据
        const bgCombineData = [];
        for(let j = 0; j < 7; j++){
            const combinedataBgLine = [];
            for(let i = 0; i < valueWidth; i++){
                const dataByte = romData[bgAddr + i + j * valueWidth];
                // 每个字节包含两个4位索引：高4位(A)和低4位(B)
                if(valueWidth === 4){
                    const highNibble = (dataByte >> 4) & 0x0F; // 高4位
                    const lowNibble = dataByte & 0x0F;         // 低4位
                    combinedataBgLine.push(highNibble);
                    combinedataBgLine.push(lowNibble);
                }else{
                    combinedataBgLine.push(dataByte);
                }

            }
            bgCombineData.push(combinedataBgLine);
        }
        return bgCombineData;
    }

    /**
     * 解析单个 8x8 的背景图块
     * @param {Uint8Array} romData - ROM 数据
     * @param {number} tileIndex - 图块索引
     * @param {number} baseAddr - CHR ROM 基地址
     * @param {Array} paletteGroup - 4色调色板组
     * @returns {Array} 8×8 像素数据
     */
    parseBgTile(romData, tileIndex, baseAddr, paletteGroup){
        // 计算图块地址：基地址 + 索引 × 0x10
        const tileAddr = baseAddr + (tileIndex * 0x10);
        
        // 创建 8x8 像素数组
        const tilePixels = [];
        
        // 解析 8 行像素
        for(let row = 0; row < 8; row++){
            const bitplane0 = romData[tileAddr + row];     // 低位平面
            const bitplane1 = romData[tileAddr + row + 8]; // 高位平面
            
            const rowPixels = [];
            
            // 解析 8 列像素（从高位到低位）
            for(let col = 0; col < 8; col++){
                const bitPos = 7 - col; // NES 是从高位到低位
                const bit0 = (bitplane0 >> bitPos) & 1;
                const bit1 = (bitplane1 >> bitPos) & 1;
                const colorIndex = (bit1 << 1) | bit0; // 组合成 0-3 的颜色索引
                
                // 使用调色板获取实际颜色
                const color = paletteGroup[colorIndex];
                
                rowPixels.push({
                    colorIndex: colorIndex,
                    color: color
                });
            }
            
            tilePixels.push(rowPixels);
        }
        
        return tilePixels;
    }

    /**
     * 渲染完整的背景图像
     * @param {Uint8Array} romData - ROM 数据
     * @param {Object} bgInfo - 背景信息对象
     * @param {number} baseAddr - CHR ROM 基地址
     * @returns {Object} 包含像素数据的对象
     */
    renderBgImage(romData, bgInfo, baseAddr){
        const { bgData, bgAttributeData, palette } = bgInfo;
        
        // 将调色板分成8组，每组4色
        // 尝试使用前4组（背景调色板）
        const paletteGroups = [];
        for(let i = 0; i < 8; i++){
            const group = [
                palette[i * 4],
                palette[i * 4 + 1],
                palette[i * 4 + 2],
                palette[i * 4 + 3]
            ];
            paletteGroups.push(group);
        }
        
        //console.log(`渲染背景: ${bgData[0].length}×${bgData.length} 个图块`);
        
        // 创建完整的像素数据 (32×8 = 256 像素宽, 28×8 = 224 像素高)
        const fullPixels = [];
        
        // 遍历每个图块行
        for(let tileRow = 0; tileRow < bgData.length; tileRow++){
            const tileRowData = bgData[tileRow];
            const attrRowData = bgAttributeData[tileRow];
            
            // 每个图块有8行像素
            for(let pixelRow = 0; pixelRow < 8; pixelRow++){
                const fullPixelRow = [];
                
                // 遍历这一行的每个图块
                for(let tileCol = 0; tileCol < tileRowData.length; tileCol++){
                    const tileIndex = tileRowData[tileCol];
                    const attrIndex = attrRowData[tileCol];
                    
                    // 获取对应的调色板组
                    const paletteGroup = paletteGroups[attrIndex];
                    
                    // 解析这个图块
                    const tilePixels = this.parseBgTile(romData, tileIndex, baseAddr, paletteGroup);
                    
                    // 将这个图块的当前行像素添加到完整行中
                    fullPixelRow.push(...tilePixels[pixelRow]);
                }
                
                fullPixels.push(fullPixelRow);
            }
        }
        
        //console.log(`背景渲染完成: ${fullPixels[0].length}×${fullPixels.length} 像素`);
        
        return {
            pixels: fullPixels,
            width: fullPixels[0].length,
            height: fullPixels.length
        };
    }

    loadTileIndex(romData, levelType){
        const tileIndexAddrAddr = app.romEditor.getRomAddrByOriginalRomAddr(0x4CC2 + levelType * 2);
        let tileIndexAddr = romData[tileIndexAddrAddr + 1] * 0x100 + romData[tileIndexAddrAddr];
        //tileIndexAddr = tileIndexAddr - 0x8000 + 0x0010;
        tileIndexAddr = app.romEditor.getRomAddressFromOriginalCpuAddress(tileIndexAddr);
        //不管原本多少个都拼16个。
        const tileCombines = [];
        for(let tileIndex = 0; tileIndex < 16; tileIndex++){

            const sigleTile = [];
            for(let j = 0; j < 4; j++){
                const sigleTileLine = [];
                for(let i = 0; i < 4; i++){
                    const tileAddr = tileIndexAddr + tileIndex * 16 + j * 4 + i;
                    const tileByte = romData[tileAddr];
                    // const highNibble = (tileByte >> 4) & 0x0F; // 高4位(A)
                    // const lowNibble = tileByte & 0x0F;         // 低4位(B)
                    // sigleTileLine.push(highNibble);
                    sigleTileLine.push(tileByte);
                }
                sigleTile.push(sigleTileLine);
            }
            tileCombines.push(sigleTile)
        }

        return tileCombines;
    }
}