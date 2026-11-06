function expandMapper(newRomData){
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
    Asm6502.writeBytes(newRomData, updatePPUCodeAddr, updatePPUCode);

    //写入切换 拷贝 图形代码代码
    const loadGraphicsFromPRG = [
        0x48, 0x8A, 0x48, 0x98, 0x48, 0xA5, 0x30, 0x48, 0xA5, 0x31, 0x48, 0xA5, 0x2F, 0x85, 0x2E, 0xA9,
        0x00, 0x8D, 0x00, 0x20, 0x8D, 0x01, 0x20, 0xA5, 0x2F, 0x4A, 0x18, 0x69, 0x02, 0x8D, 0x00, 0x80,
        0xA5, 0x2F, 0x29, 0x01, 0xF0, 0x04, 0xA9, 0xA0, 0xD0, 0x02, 0xA9, 0x80, 0x85, 0x31, 0xA9, 0x00,
        0x85, 0x30, 0xAD, 0x02, 0x20, 0xA9, 0x00, 0x8D, 0x06, 0x20, 0x8D, 0x06, 0x20, 0xA2, 0x20, 0xA0,
        0x00, 0xB1, 0x30, 0x8D, 0x07, 0x20, 0xC8, 0xD0, 0xF8, 0xE6, 0x31, 0xCA, 0xD0, 0xF3, 0xA9, 0x1E,
        0x8D, 0x01, 0x20, 0xA9, 0x00, 0x8D, 0x05, 0x20, 0x8D, 0x05, 0x20, 0xA9, 0x00, 0x8D, 0x00, 0x80,
        0xA9, 0x80, 0x8D, 0x00, 0x20, 0x68, 0x85, 0x31, 0x68, 0x85, 0x30, 0x68, 0xA8, 0x68, 0xAA, 0x68,
        0x60,
    ];
    const fixedTitleAddr  = Asm6502.writeBytes(newRomData, ppuMoveCodeAddr, loadGraphicsFromPRG);
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

    const loadAddressTablecCodeAddr = Asm6502.writeBytes(newRomData, fixedTitleAddr, fixTitleScreenCode);
    //JSR 加载关卡地址表代码
    const loadAddressTablecCodeCPUAddr = RomLayout.cpuFromProgramOffset(loadAddressTablecCodeAddr);
    const jsrLoadAddressTableAddr = 0x0D32;
    const jsrLoadAddressTableCode = [
        0x20, loadAddressTablecCodeCPUAddr & 0xFF, (loadAddressTablecCodeCPUAddr >> 8) & 0xFF,
        0xEA, 0xEA,
        0xEA, 0xEA, 0xEA,
        0xEA, 0xEA
    ]
    Asm6502.writeBytes(newRomData, jsrLoadAddressTableAddr, jsrLoadAddressTableCode);

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
    const loadFirstLevelDataAddr = Asm6502.writeBytes(newRomData, loadAddressTablecCodeAddr, loadAddressTablecCode);
    const cpuLoadFirstLevelDataAddr = RomLayout.cpuFromProgramOffset(loadFirstLevelDataAddr);
    //JSR 加载关卡第一个数据
    const jsrLoadFirstLevelDataAddr = 0x0D19;
    const jsrLoadFirstLevelDataCode = [
        0x20, cpuLoadFirstLevelDataAddr & 0xFF, (cpuLoadFirstLevelDataAddr >> 8) & 0xFF,
        0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA
    ];
    Asm6502.writeBytes(newRomData, jsrLoadFirstLevelDataAddr, jsrLoadFirstLevelDataCode);

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
    const loadLevelCodeAddr = Asm6502.writeBytes(newRomData, loadFirstLevelDataAddr, loadFirstLevelDataCode);
    const loadLevelCodeCPUAddr = RomLayout.cpuFromProgramOffset(loadLevelCodeAddr);
    //loadLevel
    const jsrLoadLevelAddr = 0x2929;
    const jsrLoadLevelCode = [
        0x20, loadLevelCodeCPUAddr & 0xFF, (loadLevelCodeCPUAddr >> 8) & 0xFF,
        0xEA
    ]
    Asm6502.writeBytes(newRomData, jsrLoadLevelAddr, jsrLoadLevelCode);
    // The native decoder advances only its eight-bit Y index at $A91F.
    // Dense custom maps can exceed 256 encoded bytes. Advance in the helper
    // instead, carrying Y's wrap into the source pointer's high byte ($01).
    newRomData[RomLayout.programOffset(0xA91F)] = 0xEA;
    const loadLevelCode = [
        0xA9, 0x04,
        0x8D, 0x00, 0x80,
        0xB1, 0x00,
        0x48,
        0xA9, 0x00,
        0x8D, 0x00, 0x80,
        0x68,
        0xC8,                   // INY
        0xD0, 0x02,             // BNE ready
        0xE6, 0x01,             // INC $01
        0xC9, 0xFF,
        0x60
    ]
    const loadPlayerInfo = Asm6502.writeBytes(newRomData, loadLevelCodeAddr, loadLevelCode);

    const jsrLoadPlayerInfo = 0x1B1C;
    const jsrLoadPlayerInfoCode = [
        0x20, RomLayout.cpuFromProgramOffset(loadPlayerInfo) & 0xFF, (RomLayout.cpuFromProgramOffset(loadPlayerInfo) >> 8) & 0xFF,
        0xEA
    ]
    Asm6502.writeBytes(newRomData, jsrLoadPlayerInfo, jsrLoadPlayerInfoCode);

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
    const loadDoorInfoAddr = Asm6502.writeBytes(newRomData, loadPlayerInfo, loadPlayerInfoCode);
    const jsrLoadDoorInfo = 0x35F9;
    const jsrLoadDoorInfoCode = [
        0x20, RomLayout.cpuFromProgramOffset(loadDoorInfoAddr) & 0xFF, (RomLayout.cpuFromProgramOffset(loadDoorInfoAddr) >> 8) & 0xFF,
        0xEA,
        0xEA,
        0xEA, 0xEA,
        0xEA, 0xEA,
    ]
    Asm6502.writeBytes(newRomData, jsrLoadDoorInfo, jsrLoadDoorInfoCode);

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
    const loadEnemyCountAddr = Asm6502.writeBytes(newRomData, loadDoorInfoAddr, loadDoorInfoCode);

    //load enemy info
    newRomData[0x33D9] = 0x00;
    newRomData[0x33DA] = 0x83;

    const jsrLoadenemyCountAddr = 0x2DD9;
    const jsrLoadenemyCountCode = [
        0x20, RomLayout.cpuFromProgramOffset(loadEnemyCountAddr) & 0xFF, (RomLayout.cpuFromProgramOffset(loadEnemyCountAddr) >> 8) & 0xFF,
    ]
    Asm6502.writeBytes(newRomData, jsrLoadenemyCountAddr, jsrLoadenemyCountCode);

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
    const loadEnemyInfoCodeAddr = Asm6502.writeBytes(newRomData, loadEnemyCountAddr, loadLoadEnemyCountCode);

    const jsrLoadEnemyInfoAddr = 0x2DE6;
    const jsrLoadEnemyInfoCode = [
        0x20, RomLayout.cpuFromProgramOffset(loadEnemyInfoCodeAddr) & 0xFF, (RomLayout.cpuFromProgramOffset(loadEnemyInfoCodeAddr) >> 8) & 0xFF,
        0xEA,
    ]
    Asm6502.writeBytes(newRomData, jsrLoadEnemyInfoAddr, jsrLoadEnemyInfoCode);

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

    const loadEnemyPositionAddr = Asm6502.writeBytes(newRomData, loadEnemyInfoCodeAddr, loadEnemyInfoCode);
    const jsrLoadEnemyPositionAddr = 0x2E11;
    const jsrLoadEnemyPositionCode = [
        0x20, RomLayout.cpuFromProgramOffset(loadEnemyPositionAddr) & 0xFF, (RomLayout.cpuFromProgramOffset(loadEnemyPositionAddr) >> 8) & 0xFF,
        0xEA, 0xEA
    ]

    Asm6502.writeBytes(newRomData, jsrLoadEnemyPositionAddr, jsrLoadEnemyPositionCode);

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
    const skipLevelEnemyInfoAddr = Asm6502.writeBytes(newRomData, loadEnemyPositionAddr, loadenemyPositionCode);

    // const jsrSkipLevelEnemyInfoAddr = 0x2DC9;
    // const jsrSkipLevelEnemyInfoCode = [
    //     0x20, RomLayout.cpuFromProgramOffset(skipLevelEnemyInfoAddr) & 0xFF, (RomLayout.cpuFromProgramOffset(skipLevelEnemyInfoAddr) >> 8) & 0xFF,
    // ]
    // Asm6502.writeBytes(newRomData, jsrSkipLevelEnemyInfoAddr, jsrSkipLevelEnemyInfoCode);
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
        0x20, RomLayout.cpuFromProgramOffset(skipLevelEnemyInfoAddr) & 0xFF, (RomLayout.cpuFromProgramOffset(skipLevelEnemyInfoAddr) >> 8) & 0xFF,
        0xA0, 0x00,
        0xA2, 0x00,
        0xA9, 0x00,
        0xEA, 0xEA,
        0xEA, 0xEA,
        0xEA, 0xEA, 0xEA,
    ]
    Asm6502.writeBytes(newRomData, jsrSkipLevelEnemyInfoAddr, jsrSkipLevelEnemyInfoCode);
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

    const timerRoutineAddr = Asm6502.writeBytes(newRomData, skipLevelEnemyInfoAddr, skipLevelEnemyInfoCode);
    const timerCallAddr = 0x0AE5;
    const timerCall = [
        0x20, RomLayout.cpuFromProgramOffset(timerRoutineAddr) & 0xFF, (RomLayout.cpuFromProgramOffset(timerRoutineAddr) >> 8) & 0xFF,
        0xEA, 0xEA,
        0xEA,
        0xEA, 0xEA, 0xEA, 0xEA,
        0xEA,
    ]
    Asm6502.writeBytes(newRomData, timerCallAddr, timerCall);
    const timerDataCpuAddr = (RomLayout.LEVEL_TIMER_EXPANDED - 0x10) % 0x4000 + 0x8000
    const timerRoutine = [
        0xA9, 0x01,
        0x8D, 0x00, 0x80,
        0xB9, timerDataCpuAddr & 0xFF, (timerDataCpuAddr >> 8) & 0xFF,
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
    const loadersEnd = Asm6502.writeBytes(newRomData, timerRoutineAddr, timerRoutine);
    if (loadersEnd > RomLayout.programOffset(0xF0D7))
        throw new Error('Expansion loaders overlap the camera-reset reservation');

    /*
     * Keep NMI execution out of a switchable PRG bank.
     *
     * The expanded-ROM data helpers at $F004-$F0D6 temporarily map bank 1
     * or bank 4 at $8000-$BFFF. If NMI starts before a helper restores
     * bank 0, the original vector at $807C points into data instead of
     * executable code.
     *
     * The idle loop at $8070 runs only in bank 0. Keep its usual NMI
     * latency: the exit animation uses nearly the entire vblank. For
     * other PCs, skip the NMI during a $F0xx loader or portal bank switch.
     */
    const bankSafeNmiCpuAddr = 0xF0E2;
    const fixedBankRomAddr =
        RomLayout.FIXED_BANK * 0x4000 + 0x10;
    const bankSafeNmiRomAddr =
        fixedBankRomAddr + (bankSafeNmiCpuAddr - 0xC000);
    const nmiVectorRomAddr =
        fixedBankRomAddr + (0xFFFA - 0xC000);
    const bankSafeNmiCode = [
        0x48,                   // PHA
        0x8A, 0x48,             // TXA; PHA
        0xBA,                   // TSX
        0xBD, 0x05, 0x01,       // LDA $0105,X (interrupted PC high)
        0xC9, 0x80,             // CMP #$80
        0xD0, 0x03,             // BNE checkBank
        0x4C, 0x7F, 0x80,       // nativeNmi: JMP $807F (native TYA/PHA and body)
        0xC9, 0xF0,             // CMP #$F0
        0xF0, 0x05,             // BEQ skipNmi
        0xAD, Portal.PORTAL_RAM.bankActive & 255, Portal.PORTAL_RAM.bankActive >> 8,
        0xF0, 0xF4,             // BEQ nativeNmi
        0x68, 0xAA,             // skipNmi: PLA; TAX
        0x68, 0x40,             // PLA; RTI
    ];
    Asm6502.writeBytes(
        newRomData,
        bankSafeNmiRomAddr,
        bankSafeNmiCode
    );
    newRomData[nmiVectorRomAddr] = bankSafeNmiCpuAddr & 0xFF;
    newRomData[nmiVectorRomAddr + 1] =
        (bankSafeNmiCpuAddr >> 8) & 0xFF;

    return newRomData;
}
