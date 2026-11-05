/** Compute active level offsets once for capacity checks, address labels and export. */
class LevelLayout {
    static mapCapacity = RomLayout.LEVEL_DATA_END_EXPANDED - RomLayout.LEVEL_DATA_EXPANDED;
    static enemyCapacity = RomLayout.ENEMY_DATA_END_EXPANDED - RomLayout.ENEMY_DATA_EXPANDED;
    static maxCount = 0x7F;

    static calculate(levels, count) {
        let map = RomLayout.LEVEL_DATA_EXPANDED;
        let enemy = RomLayout.ENEMY_DATA_EXPANDED;
        const entries = [];
        for (const level of levels.slice(0, count)) {
            entries.push({romAddress: map, cpuAddress: 0x8000 + (map - 16) % 0x4000,
                monsterRomAddress: enemy, monsterCpuAddress: 0x8000 + (enemy - 16) % 0x4000});
            map += level.getTotalSize(); // Includes the terminating FF.
            enemy += level.monsterData.length;
        }
        return {entries, mapBytes: map - RomLayout.LEVEL_DATA_EXPANDED,
            enemyBytes: enemy - RomLayout.ENEMY_DATA_EXPANDED};
    }

    static validate(count, mapBytes, enemyBytes) {
        if (!Number.isInteger(count) || count < 1 || count > this.maxCount)
            return i18n.t('invalidLevelCountMessageError', {maxLevelCount: this.maxCount});
        if (mapBytes > this.mapCapacity)
            return i18n.t('levelDataSizeExceedError', {currentSize: mapBytes, maxSize: this.mapCapacity});
        if (enemyBytes > this.enemyCapacity)
            return i18n.t('enemyDataSizeExceedError', {currentSize: enemyBytes, maxSize: this.enemyCapacity});
        return null;
    }
}
