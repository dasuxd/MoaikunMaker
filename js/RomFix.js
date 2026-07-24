class Romfix{
    // Fix original version rom
    static fixOriginalRom(romData, isExpanded = false){
        Romfix.backupUnusedImages(romData);
        Romfix.fixPlayerDeathBug(romData);
        Romfix.fixSpecialLevelAnimations(romData, isExpanded);
        Romfix.fixWideScreenRockPushBug(romData, isExpanded);
        Romfix.addMoaikunMakerLabel(romData);
    }
    // Backup unused images.
    static backupUnusedImages(romData){
        let index = 0xEA70;
        let indexEnd = 0xEE10;
        const backupAddr = 0x8C50;
        // If 0x8C50 is all zeros, means no backup has been made
        let needBackup = true;
        for(let i = backupAddr; i < backupAddr + (indexEnd - index); i++){
            if(romData[i] !== 0x00){
                needBackup = false;
                break;
            }
        }

        if(needBackup){
            const page1Addr = 0xAA70;
            const page2Addr = 0xCA70;
            for(;index < indexEnd; index++){
                let offset = index - 0xEA70;
                // Backup address
                romData[backupAddr + offset] = romData[page1Addr + offset];
                // Write new data
                romData[page1Addr + offset] = romData[index];
                romData[page2Addr + offset] = romData[index];
            }
        }
    }

    //Fix bug where player dies when reaching max height, using some code space I believe is unused
    static fixPlayerDeathBug(romData){
        const fixedCode = [0x18, 0xA5, 0xC4, 0x65, 0xC8, 0x85, 0xC4, 0xAD, 0x1E, 0x04, 0x65, 0xC7, 0x24, 0xC7, 0x10, 0x06, 0xC9, 0xD5, 0x90, 0x02, 0xA9, 0x00, 0x8D, 0x1E, 0x04, 0x60];
        const codeAddr = 0x19A5;
        for(let i = codeAddr; i< codeAddr + fixedCode.length; i++){
            romData[i] = fixedCode[i - codeAddr];
        }
    }

    /**
     * Make the castle-background animation follow scene type 8 instead of the
     * original hard-coded level numbers 49-52.
     *
     * Each original three-byte record contains a level/type byte and a PPU
     * address. The four level-specific groups repeat the same background
     * positions, with two positions omitted where level 52's foreground covers
     * them. The replacement table stores scene/type, PPU-low and map position.
     * Before registering an animation, a helper checks the live map through
     * $8DFF and skips positions covered by foreground tiles. PPU-high is always
     * $20 for these eight background positions.
     */
    static fixSpecialLevelAnimations(romData, isExpanded = false){
        const animationTableCpuAddr = 0xD9D3;
        const animationMapFilterCpuAddr = 0xDA15;
        let animationTableRomAddr = 0x59E3;
        let fixedBankShift = 0;
        if(isExpanded){
            fixedBankShift = 0x4000 * 6;
            animationTableRomAddr += fixedBankShift;
        }

        // Record: scene/type, PPU address low byte, packed map position (X:Y).
        // Bit 7 of scene/type selects animation type 2; low 7 bits are scene 8.
        const scene8AnimationTable = [
            0x08, 0x65, 0x21,
            0x08, 0x69, 0x41,
            0x08, 0x2F, 0x70,
            0x08, 0x31, 0x80,
            0x08, 0x77, 0xB1,
            0x08, 0x7B, 0xD1,
            0x88, 0xCC, 0x63,
            0x88, 0xD2, 0x93,
            0xFF,
        ];
        Romfix.fixCodeInsert(romData, animationTableRomAddr, scene8AnimationTable);

        const animationMapFilterCode = [
            0xB9, 0xD2, 0xD9,       // LDA animationMapPosition,Y
            0x48,                   // PHA
            0x29, 0x0F,             // AND #$0F
            0x85, 0x01,             // STA mapY
            0x68,                   // PLA
            0x4A, 0x4A, 0x4A, 0x4A,// LSR A * 4
            0x85, 0x00,             // STA mapX
            0x20, 0xFF, 0x8D,       // JSR getMapTile
            0xAA,                   // TAX (set Z from the returned tile)
            0xD0, 0x03,             // BNE blocked
            0x4C, 0xC5, 0xD9,       // JMP findFreeAnimationSlot
            0x60,                   // blocked: RTS
        ];
        const animationMapFilterRomAddr =
            animationTableRomAddr + (animationMapFilterCpuAddr - animationTableCpuAddr);
        Romfix.fixCodeInsert(romData, animationMapFilterRomAddr, animationMapFilterCode);

        // CPU $D99F: compare table records with scene type $3E, not level $3C.
        romData[0x59B0 + fixedBankShift] = 0x3E;

        // CPU $D9A3: filter covered map positions before allocating a slot.
        Romfix.fixCodeInsert(romData, 0x59B3 + fixedBankShift, [
            0x20,
            animationMapFilterCpuAddr & 0xFF,
            (animationMapFilterCpuAddr >> 8) & 0xFF,
        ]);
        // A blocked record or a full slot list continues scanning the table.
        Romfix.fixCodeInsert(romData, 0x59B6 + fixedBankShift, [0xD0, 0xEB]);

        // CPU $D9BB: the third record byte now stores map position, so restore
        // the constant PPU nametable high byte directly.
        Romfix.fixCodeInsert(romData, 0x59CB + fixedBankShift, [
            0xA9, 0x20,
            0x9D, 0xAE, 0x05,
            0xEA,
        ]);
    }

    /**
     * Fix round-rock pushes that cross a horizontal map boundary.
     *
     * The original rock-specific code normalizes X with 0x0F in one place and
     * skips normalization entirely in two others. That is correct for the
     * released 16-column maps, but breaks the dormant 32-column mode:
     *
     * - pushing left from column 0 checks column 15 instead of column 31;
     * - after a valid edge push, the background rock is not removed from its
     *   source column, so the moving rock sprite collides with the player;
     * - the same stale-source problem happens when pushing right from column 31.
     *
     * fixSpecialLevelAnimations() compacts four repeated level-specific
     * animation groups into one scene-based table ending at CPU $D9EB. The
     * freed bytes immediately after that terminator hold two small helpers:
     *
     * - select 0x0F or 0x1F from the wide-screen flag ($3D bit 0);
     * - hide a moving rock that has left the 256-pixel viewport in wide mode,
     *   instead of drawing its wrapped low byte at the opposite screen edge.
    */
    static fixWideScreenRockPushBug(romData, isExpanded = false){
        const normalizeRockXCpuAddr = 0xD9EC;
        let normalizeRockXRomAddr = 0x59FC;
        if(isExpanded){
            normalizeRockXRomAddr += 0x4000 * 6;
        }

        const normalizeRockXCode = [
            0x48,                   // PHA
            0xA5, 0x3D,             // LDA $3D
            0x4A,                   // LSR A (carry = wide-screen flag)
            0x68,                   // PLA
            0x29, 0x1F,             // AND #$1F
            0xB0, 0x02,             // BCS done
            0x29, 0x0F,             // AND #$0F
            0x60,                   // RTS
        ];
        Romfix.fixCodeInsert(romData, normalizeRockXRomAddr, normalizeRockXCode);

        const updateRockSpriteCpuAddr = normalizeRockXCpuAddr + normalizeRockXCode.length;
        const updateRockSpriteRomAddr = normalizeRockXRomAddr + normalizeRockXCode.length;
        const updateRockSpriteCode = [
            0x38,                   // SEC
            0xA5, 0xDE,             // LDA movingRockXLow
            0xE5, 0xFD,             // SBC cameraX
            0x8D, 0x4E, 0x04,       // STA movingRockScreenX
            0xA5, 0xDD,             // LDA movingRockXHigh
            0xE9, 0x00,             // SBC #$00
            0x48,                   // PHA
            0xA5, 0x3D,             // LDA $3D
            0x4A,                   // LSR A (carry = wide-screen flag)
            0x90, 0x09,             // BCC singleScreen
            0x68,                   // PLA
            0xF0, 0x07,             // BEQ done (inside the viewport)
            0xA9, 0x00,             // LDA #$00
            0x8D, 0x12, 0x04,       // STA movingRockSprite (hide it)
            0x60,                   // RTS
            0x68,                   // singleScreen: PLA
            0x60,                   // done: RTS
        ];
        Romfix.fixCodeInsert(romData, updateRockSpriteRomAddr, updateRockSpriteCode);

        const normalizeRockXLowByte = normalizeRockXCpuAddr & 0xFF;
        const normalizeRockXHighByte = (normalizeRockXCpuAddr >> 8) & 0xFF;
        const updateRockSpriteLowByte = updateRockSpriteCpuAddr & 0xFF;
        const updateRockSpriteHighByte = (updateRockSpriteCpuAddr >> 8) & 0xFF;

        // CPU $9E37: replace the low-byte-only sprite coordinate calculation.
        const updateRockSpriteCallerCode = [
            0xA5, 0xC0,             // LDA $C0
            0xC9, 0x03,             // CMP #$03
            0xD0, 0x03,             // BNE done
            0x20, updateRockSpriteLowByte, updateRockSpriteHighByte,
            0x60,                   // done: RTS
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
        ];
        Romfix.fixCodeInsert(romData, 0x1E47, updateRockSpriteCallerCode);

        // CPU $9E6C: normalize the destination checked by a left-edge push.
        const leftDestinationCheckCode = [
            0xC6, 0x00,             // DEC $00
            0xC6, 0x00,             // DEC $00
            0xA5, 0x00,             // LDA $00
            0xC9, 0xF0,             // CMP #$F0
            0x90, 0x03,             // BCC storeDestinationX
            0x20, normalizeRockXLowByte, normalizeRockXHighByte,
            0x85, 0x00,             // storeDestinationX: STA $00
            0xEA,                   // NOP (keep following code aligned)
        ];
        Romfix.fixCodeInsert(romData, 0x1E7C, leftDestinationCheckCode);

        // Normalize the source tile after the map lookup has wrapped $00.
        // CPU $9E82 handles left pushes; CPU $9EB1 handles right pushes.
        const normalizeRockSourceCode = [
            0xA5, 0x00,             // LDA $00
            0x20, normalizeRockXLowByte, normalizeRockXHighByte,
            0x85, 0x00,             // STA $00
            0xEA, 0xEA, 0xEA,       // NOP padding
        ];
        Romfix.fixCodeInsert(romData, 0x1E92, normalizeRockSourceCode);
        Romfix.fixCodeInsert(romData, 0x1EC1, normalizeRockSourceCode);
    }

    // moaikun maker label
    static addMoaikunMakerLabel(romData){
        const labelCode = [0xE3, 0xE2, 0x17, 0x0B, 0x0E, 0x0F, 0xE3, 0x21, 0x13, 0x1E, 0x12, 0xE2, 0xE3, 0xE2, 0xE3, 0xE2, 0xE3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0x17, 0x19, 0x0B, 0x13, 0x15, 0x1F, 0x18, 0xD2, 0x17, 0x0B, 0x15, 0x0F, 0x1C];
        const labelAddr = 0x05D9;
        for(let i = labelAddr; i< labelAddr + labelCode.length; i++){
            romData[i] = labelCode[i - labelAddr];
        }
    }


    static expandRomCode(newRomData){
        //修改头
        newRomData[0x4] = 0x08;
        newRomData[0x5] = 0x00;
        newRomData[0x6] = 0x21;
        newRomData[0x7] = 0x00;

        const numBytes = 0x10000;

        let ppuMoveCodeAddr = 0x1EF90;
        let ppuMoveCodeCpuAddr = ppuMoveCodeAddr - numBytes - 0x10;
        let ppuMoveCodeCpuAddrPart = new Array(2);
        ppuMoveCodeCpuAddrPart[0] = ppuMoveCodeCpuAddr & 0xFF;
        ppuMoveCodeCpuAddrPart[1] = (ppuMoveCodeCpuAddr >> 8) & 0xFF;

        //
        const updatePPUCodeAddr = 0x00BE;
        const updatePPUCode = [0xA5, 0x2F, 0xC5, 0x2E, 0xF0, 0x03, 0x20, ppuMoveCodeCpuAddrPart[0], ppuMoveCodeCpuAddrPart[1]];
        Romfix.fixCodeInsert(newRomData, updatePPUCodeAddr, updatePPUCode);

        //写入切换 拷贝 图形代码代码
        const loadGraphicsFromPRG = [
            0x48, 0x8A, 0x48, 0x98, 0x48, 0xA5, 0x30, 0x48, 0xA5, 0x31, 0x48, 0xA5, 0x2F, 0x85, 0x2E, 0xA9,
            0x00, 0x8D, 0x00, 0x20, 0x8D, 0x01, 0x20, 0xA5, 0x2F, 0x4A, 0x18, 0x69, 0x02, 0x8D, 0x00, 0x80,
            0xA5, 0x2F, 0x29, 0x01, 0xF0, 0x04, 0xA9, 0xA0, 0xD0, 0x02, 0xA9, 0x80, 0x85, 0x31, 0xA9, 0x00,
            0x85, 0x30, 0xAD, 0x02, 0x20, 0xA9, 0x00, 0x8D, 0x06, 0x20, 0x8D, 0x06, 0x20, 0xA2, 0x20, 0xA0,
            0x00, 0xB1, 0x30, 0x8D, 0x07, 0x20, 0xC8, 0xD0, 0xF8, 0xE6, 0x31, 0xCA, 0xD0, 0xF3, 0xA9, 0x1E,
            0x8D, 0x01, 0x20, 0xA9, 0x00, 0x8D, 0x05, 0x20, 0x8D, 0x05, 0x20, 0xA9, 0x80, 0x8D, 0x00, 0x20,
            0xA9, 0x00, 0x8D, 0x00, 0x80, 0x68, 0x85, 0x31, 0x68, 0x85, 0x30, 0x68, 0xA8, 0x68, 0xAA, 0x68,
            0x60,
        ];
        const fixedTitleAddr  = Romfix.fixCodeInsert(newRomData, ppuMoveCodeAddr, loadGraphicsFromPRG);
        const fixTitleScreenCode = [
            0xA9, 0xB0, 
            0x85, 0xFF, 
            0x8D, 0x00, 0x20, 
            0xA9, 0x1E, 
            0x85, 0xFE, 
            0xA9, 0x05, 
            0x85, 0x1D, 
            0x20, 
            ppuMoveCodeCpuAddrPart[0], ppuMoveCodeCpuAddrPart[1], 
            0x60 
        ]
        const fixedTitleCpuAddr = fixedTitleAddr - numBytes - 0x10;
        newRomData[0x007E] = fixedTitleCpuAddr & 0xFF;
        newRomData[0x007F] = (fixedTitleCpuAddr >> 8) & 0xFF;

        const loadAddressTablecCodeAddr = Romfix.fixCodeInsert(newRomData, fixedTitleAddr, fixTitleScreenCode);
        //JSR 加载关卡地址表代码
        const loadAddressTablecCodeCPUAddr = Romfix.getCpuAddressOffset(loadAddressTablecCodeAddr);
        const jsrLoadAddressTableAddr = 0x0D32;
        const jsrLoadAddressTableCode = [
            0x20, loadAddressTablecCodeCPUAddr & 0xFF, (loadAddressTablecCodeCPUAddr >> 8) & 0xFF,
            0xEA, 0xEA, 
            0xEA, 0xEA, 0xEA, 
            0xEA, 0xEA 
        ]
        Romfix.fixCodeInsert(newRomData, jsrLoadAddressTableAddr, jsrLoadAddressTableCode);
        
        const loadAddressTablecCode = [
            0x48, 
            0xA9, 0x01, 
            0x8D, 0x00, 0x80, 
            0xB9, 0xFE, 0x7F, 
            0x85, 0x00, 
            0xB9, 0xFF, 0x7F,
            0x85, 0x01, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68, 
            0x60 
        ]
        const loadFirstLevelDataAddr = Romfix.fixCodeInsert(newRomData, loadAddressTablecCodeAddr, loadAddressTablecCode);
        const cpuLoadFirstLevelDataAddr = Romfix.getCpuAddressOffset(loadFirstLevelDataAddr);
        //JSR 加载关卡第一个数据
        const jsrLoadFirstLevelDataAddr = 0x0D19;
        const jsrLoadFirstLevelDataCode = [
            0x20, cpuLoadFirstLevelDataAddr & 0xFF, (cpuLoadFirstLevelDataAddr >> 8) & 0xFF,
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA
        ];
        Romfix.fixCodeInsert(newRomData, jsrLoadFirstLevelDataAddr, jsrLoadFirstLevelDataCode);

        //
        const loadFirstLevelDataCode = [
            0xA9, 0x04, 
            0x8D, 0x00, 0x80, 
            0xB1, 0x00, 
            0x48, 
            0x4A, 
            0x4A, 
            0x4A, 
            0x4A, 
            0x85, 0x3D, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68,
            0x60 
        ]
        const loadLevelCodeAddr = Romfix.fixCodeInsert(newRomData, loadFirstLevelDataAddr, loadFirstLevelDataCode);
        const loadLevelCodeCPUAddr = Romfix.getCpuAddressOffset(loadLevelCodeAddr);
        //loadLevel
        const jsrLoadLevelAddr = 0x2929;
        const jsrLoadLevelCode = [
            0x20, loadLevelCodeCPUAddr & 0xFF, (loadLevelCodeCPUAddr >> 8) & 0xFF,
            0xEA
        ]
        Romfix.fixCodeInsert(newRomData, jsrLoadLevelAddr, jsrLoadLevelCode);
        const loadLevelCode = [
            0xA9, 0x04, 
            0x8D, 0x00, 0x80, 
            0xB1, 0x00, 
            0x48, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68, 
            0xC9, 0xFF, 
            0x60 
        ]
        const loadPlayerInfo = Romfix.fixCodeInsert(newRomData, loadLevelCodeAddr, loadLevelCode);

        const jsrLoadPlayerInfo = 0x1B1C;
        const jsrLoadPlayerInfoCode = [
            0x20, Romfix.getCpuAddressOffset(loadPlayerInfo) & 0xFF, (Romfix.getCpuAddressOffset(loadPlayerInfo) >> 8) & 0xFF, 
            0xEA
        ]
        Romfix.fixCodeInsert(newRomData, jsrLoadPlayerInfo, jsrLoadPlayerInfoCode);

        const loadPlayerInfoCode = [
            0xA9, 0x04, 
            0x8D, 0x00, 0x80, 
            0xB1, 0x00, 
            0x48, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68, 
            0x85, 0x00, 
            0x60 
        ]
        const loadDoorInfoAddr = Romfix.fixCodeInsert(newRomData, loadPlayerInfo, loadPlayerInfoCode);
        const jsrLoadDoorInfo = 0x35F9;
        const jsrLoadDoorInfoCode = [
            0x20, Romfix.getCpuAddressOffset(loadDoorInfoAddr) & 0xFF, (Romfix.getCpuAddressOffset(loadDoorInfoAddr) >> 8) & 0xFF,
            0xEA,
            0xEA,
            0xEA, 0xEA,
            0xEA, 0xEA,
        ]
        Romfix.fixCodeInsert(newRomData, jsrLoadDoorInfo, jsrLoadDoorInfoCode);

        const loadDoorInfoCode = [
            0xA9, 0x04, 
            0x8D, 0x00, 0x80, 
            0xB1, 0x00, 
            0x85, 0x63, 
            0xC8, 
            0xB1, 0x00, 
            0x85, 0x64, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x60 
        ]
        const loadEnemyCountAddr = Romfix.fixCodeInsert(newRomData, loadDoorInfoAddr, loadDoorInfoCode);

        //load enemy info
        newRomData[0x33D9] = 0x00;
        newRomData[0x33DA] = 0x83;

        const jsrLoadenemyCountAddr = 0x2DD9;
        const jsrLoadenemyCountCode = [
            0x20, Romfix.getCpuAddressOffset(loadEnemyCountAddr) & 0xFF, (Romfix.getCpuAddressOffset(loadEnemyCountAddr) >> 8) & 0xFF,  
        ]
        Romfix.fixCodeInsert(newRomData, jsrLoadenemyCountAddr, jsrLoadenemyCountCode);

        const loadLoadEnemyCountCode = [
            0xA9, 0x01, 
            0x8D, 0x00, 0x80, 
            0xB1, 0x06, 
            0x48, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68, 
            0x4A, 
            0x60 
        ]
        const loadEnemyInfoCodeAddr = Romfix.fixCodeInsert(newRomData, loadEnemyCountAddr, loadLoadEnemyCountCode);

        const jsrLoadEnemyInfoAddr = 0x2DE6;
        const jsrLoadEnemyInfoCode = [
            0x20, Romfix.getCpuAddressOffset(loadEnemyInfoCodeAddr) & 0xFF, (Romfix.getCpuAddressOffset(loadEnemyInfoCodeAddr) >> 8) & 0xFF,  
            0xEA, 
        ]
        Romfix.fixCodeInsert(newRomData, jsrLoadEnemyInfoAddr, jsrLoadEnemyInfoCode);

        const loadEnemyInfoCode = [
            0xA9, 0x01, 
            0x8D, 0x00, 0x80, 
            0xB1, 0x06, 
            0x48, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68, 
            0x85, 0x00, 
            0x60 
        ]

        const loadEnemyPositionAddr = Romfix.fixCodeInsert(newRomData, loadEnemyInfoCodeAddr, loadEnemyInfoCode);
        const jsrLoadEnemyPositionAddr = 0x2E11;
        const jsrLoadEnemyPositionCode = [
            0x20, Romfix.getCpuAddressOffset(loadEnemyPositionAddr) & 0xFF, (Romfix.getCpuAddressOffset(loadEnemyPositionAddr) >> 8) & 0xFF,
            0xEA, 0xEA
        ]

        Romfix.fixCodeInsert(newRomData, jsrLoadEnemyPositionAddr, jsrLoadEnemyPositionCode);

        const loadenemyPositionCode = [
            0xA9, 0x01, 
            0x8D, 0x00, 0x80, 

            0xB1, 0x06, 
            0x48,

            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 

            0x68, 
            0x9D, 0x76, 0x05, 

            0x60 
        ]
        const skipLevelEnemyInfoAddr = Romfix.fixCodeInsert(newRomData, loadEnemyPositionAddr, loadenemyPositionCode);


        // const jsrSkipLevelEnemyInfoAddr = 0x2DC9;
        // const jsrSkipLevelEnemyInfoCode = [
        //     0x20, Romfix.getCpuAddressOffset(skipLevelEnemyInfoAddr) & 0xFF, (Romfix.getCpuAddressOffset(skipLevelEnemyInfoAddr) >> 8) & 0xFF,
        // ]
        // Romfix.fixCodeInsert(newRomData, jsrSkipLevelEnemyInfoAddr, jsrSkipLevelEnemyInfoCode);
        // const skipLevelEnemyInfoCode = [
        //     0xA9, 0x01, 
        //     0x8D, 0x00, 0x80, 
        //     0xB1, 0x06, 
        //     0x48, 
        //     0xA9, 0x00, 
        //     0x8D, 0x00, 0x80, 
        //     0x68, 
        //     0x18, 
        //     0x60 
        // ]

        // add enemy address table
        const jsrSkipLevelEnemyInfoAddr = 0x2DC7;
        const jsrSkipLevelEnemyInfoCode = [
            0x8A, 
            0x0A, 
            0x20, Romfix.getCpuAddressOffset(skipLevelEnemyInfoAddr) & 0xFF, (Romfix.getCpuAddressOffset(skipLevelEnemyInfoAddr) >> 8) & 0xFF,
            0xA0, 0x00, 
            0xA2, 0x00, 
            0xA9, 0x00, 
            0xEA, 0xEA,
            0xEA, 0xEA,
            0xEA, 0xEA, 0xEA,
        ]
        Romfix.fixCodeInsert(newRomData, jsrSkipLevelEnemyInfoAddr, jsrSkipLevelEnemyInfoCode);
        const skipLevelEnemyInfoCode = [
            0xA8, 
            0x90, 0x02, 
            0xE6, 0x07, 
            0xA9, 0x01, 
            0x8D, 0x00, 0x80, 
            0xB1, 0x06, 
            0x48, 
            0xC8, 
            0xD0, 0x02, 
            0xE6, 0x07, 
            0xB1, 0x06, 
            0x48, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68, 
            0x85, 0x07, 
            0x68, 
            0x85, 0x06, 
            0x60 
        ]

        const timerDataRomfixCodeAddr = Romfix.fixCodeInsert(newRomData, skipLevelEnemyInfoAddr, skipLevelEnemyInfoCode);
        const jsrTimerDataRomfixCodeAddr = 0x0AE5;
        const jsrTimerDataRomfixCode = [
            0x20, Romfix.getCpuAddressOffset(timerDataRomfixCodeAddr) & 0xFF, (Romfix.getCpuAddressOffset(timerDataRomfixCodeAddr) >> 8) & 0xFF,
            0xEA, 0xEA,
            0xEA,
            0xEA, 0xEA, 0xEA, 0xEA,
            0xEA,
        ]
        Romfix.fixCodeInsert(newRomData, jsrTimerDataRomfixCodeAddr, jsrTimerDataRomfixCode);
        const timmerDataCpuAddr = (Config.LEVEL_TIMER_EXPANDED - 0x10) % 0x4000 + 0x8000
        const timerDataRomfixCode = [
            0xA9, 0x01, 
            0x8D, 0x00, 0x80, 
            0xB9, timmerDataCpuAddr & 0xFF, (timmerDataCpuAddr >> 8) & 0xFF, 
            0x48, 
            0x48, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68, 
            0x4A, 
            0x4A, 
            0x4A, 
            0x4A, 
            0x85, 0x71, 
            0x68, 
            0x60 
        ]
        Romfix.fixCodeInsert(newRomData, timerDataRomfixCodeAddr, timerDataRomfixCode);
        
        return newRomData;
    }

    static fixCodeInsert(data, insertAddr, codeArray){
        data.set(codeArray, insertAddr);
        return insertAddr + codeArray.length;
    }

    static getCpuAddressOffset(romAddr){
        if(romAddr < 0x4010){
            return 0x8000 + romAddr - 0x10;
        }
        return 0x8000 + romAddr - 0x10 - (Config.PGR_PART_2_BANK_INDEX - 1) * 0x4000;
    }


}
