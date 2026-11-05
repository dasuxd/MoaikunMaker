/** Read a supported Mapper 3 base. Editor outputs cannot be patch inputs. */
class BaseRom {
    static read(input) {
        const bytes = new Uint8Array(new Uint8Array(input));
        const matches = (offset, values) => values.every((v, i) => bytes[offset + i] === v);
        const invalid = () => new Error(i18n.t('romUnsupportedStructure'));
        if (!matches(0, [0x4E, 0x45, 0x53, 0x1A]) || (bytes[6] & 4)) throw invalid();
        const mapper = (bytes[6] >> 4) | (bytes[7] & 0xF0);
        const maker = matches(0x5D9, [0xE3,0xE2,0x17,0x0B,0x0E,0x0F,0xE3,0x21,0x13,0x1E,0x12]);
        const camera = matches(0x1B48, [0xA5,0x56,0xC9,0x03]) || matches(0x1B48, [0x4C,0xCF,0xC3]);
        const pause = matches(0xB5F, [0x4C,0xD9,0xFE]);
        if (mapper === 2 || (camera && pause) ||
            (maker && (camera || pause || bytes.subarray(0x8C50, 0x8FF0).some(Boolean)))) {
            throw new Error(i18n.t('romRequiresOriginal'));
        }
        if (mapper !== 3 || bytes[4] !== 2 || bytes[5] !== 4 || bytes.length < 0x10010) throw invalid();
        const count = bytes[RomLayout.LEVEL_COUNT_ADDRESS] - 1;
        if (count < 1 || count > RomLayout.MAX_LEVEL_COUNT_ORIGINAL) throw invalid();
        const levels = [];
        let enemy = RomLayout.ENEMY_DATA_ORIGINAL;
        for (let index = 0; index < count; index++) {
            const entry = RomLayout.LEVEL_ADDRESS_TABLE_ORIGINAL + index * 2;
            const cpu = bytes[entry] | bytes[entry + 1] << 8;
            const map = cpu - 0x8000 + 16;
            if (map < RomLayout.LEVEL_DATA_ORIGINAL || map >= RomLayout.LEVEL_DATA_END_ORIGINAL) throw invalid();
            const end = bytes.subarray(map, Math.min(map + RomLayout.LEVEL_DATA_MAX_SIZE,
                RomLayout.LEVEL_DATA_END_ORIGINAL)).indexOf(0xFF);
            const size = bytes[enemy];
            if (end < 4 || !(size & 1) || size > 17 || enemy + size > RomLayout.ENEMY_DATA_END_ORIGINAL) throw invalid();
            levels.push(new Level(index, cpu, map, Array.from(bytes.subarray(map, map + end)),
                Array.from(bytes.subarray(enemy, enemy + size)), enemy - 16 + 0x8000, enemy));
            enemy += size;
        }
        // Ignore trailing dump metadata outside the declared PRG and CHR banks.
        return {bytes: bytes.subarray(0, 0x10010), levels};
    }
}
