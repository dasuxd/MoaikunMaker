module.exports = function getScenePatternData(romData, scene) {
    if (!Number.isInteger(scene) || scene < 0 || scene >= 12) return null;
    const patterns = new Uint8Array(0x2000);
    for (let page = 0; page < 32; page++) {
        const chunk = romData[0x18A10 + scene * 32 + page];
        if (chunk >= 116) throw new Error('Invalid scene graphics page');
        const address = chunk < 64 ? 0x14010 + chunk * 256
            : 0x18C10 + (chunk - 64) * 256;
        patterns.set(romData.subarray(address, address + 256), page * 256);
    }
    return patterns;
}
