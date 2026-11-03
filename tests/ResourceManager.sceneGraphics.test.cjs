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
    for (let scene = 0; scene < 12; scene++) for (const tile of [1, 2, 3, 14]) {
        assert.deepEqual(unified.getResource(scene, `tile_${tile}`), native.getResource(scene, `tile_${tile}`),
            `scene ${scene} Tile ${tile} preserves its appearance`);
    }
    for (let scene = 0; scene < 12; scene++) {
        const door = unified.getResource(scene, 'enemy_13');
        assert.deepEqual(door, native.getResource(scene, 'enemy_13'), `scene ${scene}: door survives export/reload`);
        assert.equal(door.width, 16); assert.equal(door.height, 16);
        for (let group = 0; group < 4; group++) for (const covered of [false, true]) for (const exit of [false, true]) {
            const key = `enemy_13_pair_${group + 1}${exit ? '_exit' : ''}${covered ? '_covered' : ''}`;
            const image = unified.getResource(scene, key), scheme = Romfix.getPortalColorSchemes(data, scene)[group];
            assert.deepEqual(image, native.getResource(scene, key), `${key} survives export/reload`);
            const palette = covered ? 16 + scheme.sprite * 4 : scheme.background * 4;
            const patterns = Romfix.getPortalPatterns(Romfix.getPortalColorSchemes(data, scene)), tiles = Romfix.getPortalFrameTiles(group, exit ? 6 : 0);
            for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
                const at = (tiles[(y >> 3) * 2 + (x >> 3)] - Romfix.SCENE_GRAPHICS_LAYOUT.portalStart) * 16 + (y & 7), shift = 7 - (x & 7);
                const color = (patterns[at] >> shift & 1) | (patterns[at + 8] >> shift & 1) << 1;
                if (exit && x >= 5 && x < 13 && y >= 3 && y < 13) assert.equal(color, 0, key);
                assert.equal(image.pixels[y][x].color, unified.palettes[scene][palette + color], `${key}, scene ${scene}`);
            }
        }
        const palette = Romfix.getPortalColorSchemes(data, scene)[0].background * 4;
        const patterns = Romfix.getScenePatternData(data, scene);
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
            const tile = Romfix.PORTAL_FRAMES[0][(y >> 3) * 2 + (x >> 3)];
            const at = 0x1000 + tile * 16 + (y & 7), shift = 7 - (x & 7);
            const color = (patterns[at] >> shift & 1) | (patterns[at + 8] >> shift & 1) << 1;
            assert.equal(door.pixels[y][x].color, unified.palettes[scene][palette + color],
                `scene ${scene}: portal preview matches runtime background palette`);
        }
    }
    assert.deepEqual(Config.RESOURCE_IMG_CONFIG.tile_1.imgBlockIndex.map(row => row.map(tile => tile.index)),
        [[0x60, 0x62], [0x61, 0x63]]);
});
