const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const {Project, ResourceManager, SpritePatterns, GraphicsCatalog, LevelEditor, LevelCanvas, Enemy} = require('../helpers/source.cjs').load(
    ['Project','ResourceManager','SpritePatterns','GraphicsCatalog','LevelEditor','LevelCanvas','Enemy'],
    {requestAnimationFrame: callback => callback()});
const getScenePatternData = require('../helpers/compiled-scene.cjs');
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;

test('editor portal pairs keep the same pixels for entry, exit and covered placements in every scene', async (t) => {
    const resources = new ResourceManager();
    resources.palettes = Array.from({length: 12}, (_, scene) =>
        Array.from({length: 32}, (_, ink) => `scene-${scene}-ink-${ink}`));
    resources.createImage = async (pixels, width, height) => ({pixels, width, height});
    await resources.loadBgResources(new Uint8Array(0x20010));
    const previousResources = ResourceManager.instance;
    ResourceManager.instance = resources;
    t.after(() => { ResourceManager.instance = previousResources; });
    const editor = Object.create(LevelEditor.prototype);
    editor.images = new Map();
    editor.render = () => {};
    const drawn = [];
    const ctx = {save() {}, restore() {}, drawImage(image) {drawn.push(image);}};
    for (let scene = 0; scene < 12; scene++) {
        editor._currentBgId = String(scene);
        editor.resetImages();
        const groups = [];
        for (let group = 1; group <= 4; group++) {
            const key = `enemy_13_pair_${group}`;
            const entry = resources.getResource(scene, key);
            assert.equal(entry.width, 16);
            assert.equal(entry.height, 16);
            groups.push(entry.pixels);
            for (const suffix of ['_exit', '_covered', '_exit_covered']) {
                assert.deepEqual(resources.getResource(scene, key + suffix).pixels, entry.pixels,
                    `scene ${scene}, pair ${group}${suffix}: same pair must keep its colours`);
            }
            for (const covered of [false, true]) for (const exit of [false, true]) {
                LevelCanvas.drawEnemy(new Enemy(13 | ((group - 1) << 4), 2, 7),
                    ctx, editor.images, covered, exit);
                assert.deepEqual(drawn.pop().pixels, entry.pixels,
                    `scene ${scene}, pair ${group}, covered=${covered}, exit=${exit}: canvas uses the pair colours`);
            }
        }
        for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
            assert.notDeepEqual(groups[a], groups[b], `scene ${scene}: distinct pairs stay distinguishable`);
        }
    }
});

test('editor backgrounds preserve all scene artwork after runtime tile relocation', { skip: !original }, () => {
    const editor = new Project(); editor.loadROM(original);
    const resources = new ResourceManager();
    const before = resources.loadBgData(original);
    const data = editor.getROMData();
    const relocated = Uint8Array.from(original);
    data.slice(0x1C010, 0x20010).forEach((v, i) => relocated[0x4010 + i] = v);
    const after = resources.loadBgData(relocated);
    for (let scene = 0; scene < 12; scene++) {
        assert.equal(resources.loadTileIndex(relocated, scene).length, scene === 7 || scene === 8 ? 32 : 16);
        const patterns = getScenePatternData(data, scene);
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
    assert.deepEqual(GraphicsCatalog.RESOURCE_IMG_CONFIG.enemy_9.disabledLevelType, []);
});

test('Tile 1-3 previews retain theme artwork with the new common PPU positions', { skip: !original }, async () => {
    const editor = new Project(); editor.loadROM(original);
    const native = new ResourceManager();
    native.createImage = async (pixels, width, height) => ({pixels, width, height});
    native.loadBgImg = async () => {};
    // Exercise the production preview entry, including the shared bomb and
    // rescue palette preparation before portal colour schemes are selected.
    await native.initResources(original);
    const data = editor.getROMData();
    for (let scene = 0; scene < 12; scene++) {
        const patterns = getScenePatternData(data, scene);
        for (const tile of [1, 2, 3]) {
            const key = 'tile_' + tile;
            const paletteIndex = (original[0x3FF4 + 4 * scene] >> (6 - 2 * tile)) & 3;
            const colors = native.palettes[scene].slice(paletteIndex * 4, paletteIndex * 4 + 4);
            const compiledTile = await native.decodeImage(patterns,
                GraphicsCatalog.RESOURCE_IMG_CONFIG[key], colors, scene, 0, 0x1000);
            assert.deepEqual(native.getResource(scene, key), compiledTile, `scene ${scene}, ${key}`);
        }
        const door = native.getResource(scene, 'enemy_13');
        assert.equal(door.width, 16); assert.equal(door.height, 16);
        for (let group = 0; group < 4; group++) for (const covered of [false, true]) for (const exit of [false, true]) {
            const key = `enemy_13_pair_${group + 1}${exit ? '_exit' : ''}${covered ? '_covered' : ''}`;
            const image = native.getResource(scene, key), scheme = SpritePatterns.getPortalColorSchemes(data, scene)[group];
            const palette = scheme.background * 4;
            const patterns = SpritePatterns.getPortalPatterns(SpritePatterns.getPortalColorSchemes(data, scene)), tiles = SpritePatterns.getPortalFrameTiles(group, 0);
            for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
                const at = (tiles[(y >> 3) * 2 + (x >> 3)] - GraphicsCatalog.SCENE_GRAPHICS_LAYOUT.portalStart) * 16 + (y & 7), shift = 7 - (x & 7);
                const color = (patterns[at] >> shift & 1) | (patterns[at + 8] >> shift & 1) << 1;
                assert.equal(image.pixels[y][x].color, native.palettes[scene][palette + color], `${key}, scene ${scene}`);
            }
        }
        const palette = SpritePatterns.getPortalColorSchemes(data, scene)[0].background * 4;
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
            const tile = SpritePatterns.PORTAL_FRAMES[0][(y >> 3) * 2 + (x >> 3)];
            const at = 0x1000 + tile * 16 + (y & 7), shift = 7 - (x & 7);
            const color = (patterns[at] >> shift & 1) | (patterns[at + 8] >> shift & 1) << 1;
            assert.equal(door.pixels[y][x].color, native.palettes[scene][palette + color],
                `scene ${scene}: portal preview matches runtime background palette`);
        }
    }
    assert.deepEqual(GraphicsCatalog.RESOURCE_IMG_CONFIG.tile_1.imgBlockIndex.map(row => row.map(tile => tile.index)),
        [[0x60, 0x62], [0x61, 0x63]]);
});
