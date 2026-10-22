const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const source = ['Config', 'Level', 'RomFix', 'RomEditor', 'DataConverter', 'ResourceManager']
    .map(name => fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8')).join('\n');
const app = { romEditor: null };
const { Romfix, RomEditor, ResourceManager, Config } = new Function('app', 'i18n',
    `${source}\nreturn { Romfix, RomEditor, ResourceManager, Config };`)(app, { t: key => key });
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;

test('editor backgrounds preserve all scene artwork after runtime tile relocation', { skip: !original }, () => {
    const editor = new RomEditor(); editor.loadROM(original); app.romEditor = editor;
    const resources = new ResourceManager();
    const before = resources.loadBgData(original);
    const data = editor.getROMData();
    const exported = new RomEditor(); exported.loadROM(data); app.romEditor = exported;
    const after = resources.loadBgData(data);
    for (let scene = 0; scene < 12; scene++) {
        assert.equal(resources.loadTileIndex(data, scene).length, scene === 7 || scene === 8 ? 32 : 16);
        const patterns = Romfix.getScenePatternData(data, scene);
        const base = scene === 7 || scene === 8 ? 0xF010
            : [5, 6, 9, 10, 11].includes(scene) ? 0xD010 : 0xB010;
        for (let y = 0; y < 28; y++) for (let x = 0; x < 32; x++) {
            const from = base + before[scene].bgData[y][x] * 16;
            const to = 0x1000 + after[scene].bgData[y][x] * 16;
            assert.deepEqual(patterns.slice(to, to + 16), Uint8Array.from(original.slice(from, from + 16)),
                `scene ${scene} background ${x},${y}`);
        }
        assert.deepEqual(after[scene].bgAttributeData, before[scene].bgAttributeData);
    }
    assert.deepEqual(Config.RESOURCE_IMG_CONFIG.enemy_9.disabledLevelType, []);
});

test('Tile 1-3 previews retain theme artwork with the new common PPU positions', { skip: !original }, async () => {
    const editor = new RomEditor(); editor.loadROM(original); app.romEditor = editor;
    const native = new ResourceManager(); native.loadPalettes(original);
    native.createImage = async (pixels, width, height) => ({pixels, width, height});
    await native.loadBgResources(original);
    const data = editor.getROMData();
    const exported = new RomEditor(); exported.loadROM(data); app.romEditor = exported;
    const unified = new ResourceManager(); unified.loadPalettes(data);
    unified.createImage = native.createImage;
    await unified.loadBgResources(data);
    for (let scene = 0; scene < 12; scene++) for (let tile = 1; tile <= 3; tile++) {
        assert.deepEqual(unified.getResource(scene, `tile_${tile}`), native.getResource(scene, `tile_${tile}`),
            `scene ${scene} Tile ${tile} preserves its appearance`);
    }
    assert.deepEqual(Config.RESOURCE_IMG_CONFIG.tile_1.imgBlockIndex.map(row => row.map(tile => tile.index)),
        [[0x60, 0x62], [0x61, 0x63]]);
});
