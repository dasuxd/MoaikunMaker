class RomLayout {
    static programOffset(cpu) {
        return cpu - 0x8000 + 16 + (cpu >= 0xC000 ? 0x18000 : 0);
    }

    static LEVEL_COUNT_ADDRESS = 0x0BD3;

    static MAX_LEVEL_COUNT_ORIGINAL = 56;
    static LEVEL_DATA_MAX_SIZE = 13 * 15 * 2 + 4; // 13 tiles per row, 15 rows, 2 bytes per tile, plus 4 bytes header
    static MAX_ENEMIES_PER_LEVEL = 8;

    static FIXED_BANK = 7;

    static LEVEL_ADDRESS_TABLE_ORIGINAL =  0x5841;
    static LEVEL_ADDRESS_TABLE_END_ORIGINAL =  0x58B1;
    static LEVEL_DATA_ORIGINAL = 0x6F8F;
    static LEVEL_DATA_END_ORIGINAL = 0x7F8F;
    static ENEMY_DATA_ORIGINAL = 0x33DB;
    static ENEMY_DATA_END_ORIGINAL = 0x34AF;
    static PALETTES_ADDRESS_ORIGINAL = 0x564D;

    static LEVEL_ADDRESS_TABLE_EXPANDED =  0x4010;
    static LEVEL_TIMER_EXPANDED =  0x4210;
    static LEVEL_DATA_EXPANDED = 0x10010;
    static LEVEL_DATA_END_EXPANDED = 0x14010;

    static ENEMY_ADDRESS_TABLE_EXPANDED = 0x4310;
    static ENEMY_DATA_EXPANDED = 0x4510;
    static ENEMY_DATA_END_EXPANDED = 0x5610;


    static cpuFromProgramOffset(romAddr){
        if(romAddr < 0x4010){
            return 0x8000 + romAddr - 0x10;
        }
        return 0x8000 + romAddr - 0x10 - (RomLayout.FIXED_BANK - 1) * 0x4000;
    }
}
