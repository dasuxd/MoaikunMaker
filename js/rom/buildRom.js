/** Construct a fresh Mapper 2 image for a download or playtest. */
function buildRom(base, levels, count, settings) {
    const {entries, mapBytes, enemyBytes} = LevelLayout.calculate(levels, count);
    const error = LevelLayout.validate(count, mapBytes, enemyBytes);
    if (error || entries.length !== count) throw new Error(error || i18n.t('romUnsupportedStructure'));
    const rom = new Uint8Array(0x20010);
    rom.set(base.subarray(0, 0x4010));
    rom.set(base.subarray(0x4010, 0x8010), 0x1C010);
    rom.set(base.subarray(0x8010, 0x10010), 0x8010);
    const fixedShift = 6 * 0x4000;
    rom.fill(0, RomLayout.LEVEL_ADDRESS_TABLE_ORIGINAL + fixedShift, RomLayout.LEVEL_ADDRESS_TABLE_END_ORIGINAL + fixedShift);
    rom.fill(0, RomLayout.LEVEL_DATA_ORIGINAL + fixedShift, RomLayout.LEVEL_DATA_END_ORIGINAL + fixedShift);
    rom.fill(0, RomLayout.ENEMY_DATA_ORIGINAL, RomLayout.ENEMY_DATA_END_ORIGINAL);
    rom.fill(0x90, RomLayout.LEVEL_TIMER_EXPANDED, RomLayout.LEVEL_TIMER_EXPANDED + 256);
    rom[RomLayout.LEVEL_COUNT_ADDRESS] = count + 1;

    writeLevelRecords(rom, levels, entries);
    expandMapper(rom);
    applyPatches(rom, settings);
    return rom;
}

function writeLevelRecords(rom, levels, entries) {
    function writePointers(index, entry) {
        rom.set([entry.cpuAddress & 255, entry.cpuAddress >> 8], RomLayout.LEVEL_ADDRESS_TABLE_EXPANDED + index * 2);
        rom.set([entry.monsterCpuAddress & 255, entry.monsterCpuAddress >> 8], RomLayout.ENEMY_ADDRESS_TABLE_EXPANDED + index * 2);
    }
    entries.forEach((entry, index) => {
        const level = levels[index];
        writePointers(index, entry);
        rom.set(level.data, entry.romAddress);
        if (level.data[2] === LevelCodec.NO_DOOR_COORDINATE && level.data[3] === LevelCodec.NO_DOOR_COORDINATE)
            rom.fill(0, entry.romAddress + 2, entry.romAddress + 4);
        rom[entry.romAddress + level.data.length] = 0xFF;
        rom.set(level.monsterData, entry.monsterRomAddress);
    });
    // The native attract-mode demos always request levels 7 and 8.
    for (const demo of [6, 7]) if (demo >= entries.length) writePointers(demo, entries[0]);
}
