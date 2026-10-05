const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function setup(wide = false) {
    const controls = new Map();
    const document = {
        addEventListener() {},
        getElementById(id) {
            if (!controls.has(id)) controls.set(id, {});
            return controls.get(id);
        }
    };
    const app = { showMessage() {} };
    const source = ['Config', 'Level', 'Enemy', 'DataConverter', 'LevelFile', 'OptimizedMap', 'LevelEditor', 'RomEditor', 'app']
        .map(name => fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8')).join('\n');
    const classes = new Function('document', 'navigator', 'i18n', 'testApp', 'Romfix',
        `${source}\napp = testApp; return {Config, Level, DataConverter, LevelFile, LevelEditor, RomEditor, App};`)(
        document, { userAgent: '' }, { t: key => key }, app,
        { expandRomCode() {}, fixOriginalRom() {} });
    const { Config, LevelEditor } = classes;
    const editor = Object.create(LevelEditor.prototype);
    const draws = [], outlines = [];
    editor.ctx = new Proxy({
        drawImage(...args) { draws.push(args); },
        strokeRect(...args) { outlines.push(args); }
    }, { get(target, key) { return target[key] ?? (() => {}); } });
    editor.canvas = {
        width: Config.GRID_WIDTH * Config.TILE_SIZE,
        height: Config.GRID_HEIGHT * Config.TILE_SIZE,
        getBoundingClientRect() { return { left: 0, top: 0 }; }
    };
    editor.mapData = Array.from({ length: Config.GRID_HEIGHT }, () => Array(Config.GRID_WIDTH).fill(0));
    editor.optimizedMapData = editor.mapData.map(row => [...row]);
    editor.isWideScreen = wide;
    editor.currentBgId = '0';
    editor.currentTool = 'door';
    editor.currentTileId = null;
    editor.doorPos = editor.playerPos = editor.mouseGridPos = null;
    editor.enemies = [];
    editor.images = new Map([[Config.DOOR, 'door-image']]);
    editor.updateDataDisplays = editor.updateButtonImages = editor.resetImages = () => {};
    return { ...classes, editor, draws, outlines, controls };
}

function encode(state) {
    const { editor, DataConverter } = state;
    return DataConverter.fromLevelEditorToROMData({
        background: editor.isWideScreen ? 16 : 0,
        map: editor.optimizedMapData,
        door: editor.doorPos,
        player: null,
        enemies: []
    }, editor.isWideScreen);
}

test('bottom-row placement at the top-left survives saving, navigating away and reloading', () => {
    for (const wide of [false, true]) {
        const state = setup(wide), { editor, Level, LevelFile, App } = state;
        editor.performDraw(0, 1);
        assert.deepEqual(editor.doorPos, { x: 0, y: 0 });
        const saved = encode(state);
        assert.deepEqual(saved.mapData.slice(2, 4), [0, 0]);
        const record = LevelFile.parse(JSON.stringify(LevelFile.createSingle(
            LevelFile.createLevelRecord(saved.mapData, saved.monsterData)))).level;
        const app = Object.create(App.prototype);
        app.levelEditor = editor;
        app.currentLevel = 1;
        app.loadLevelToVisualEditor(new Level(1));
        assert.deepEqual(editor.doorPos, { x: 8, y: 8 });
        app.currentLevel = 0;
        app.loadLevelToVisualEditor(new Level(0, 0, 0, record.mapData, record.monsterData));
        assert.deepEqual(editor.doorPos, { x: 0, y: 0 });
        assert.deepEqual(encode(state).mapData, saved.mapData);
    }
});

test('preview and final drawing use the same bottom-left mouse anchor', () => {
    const { editor, draws, outlines, Config } = setup();
    for (const [x, y] of [[0, 1], [7, 6], [14, 13]]) {
        editor.mouseGridPos = { x, y };
        draws.length = outlines.length = 0;
        editor.drawPreview();
        const expected = [x * Config.TILE_SIZE, (y - 1) * Config.TILE_SIZE,
            Config.TILE_SIZE * 2, Config.TILE_SIZE * 2];
        assert.deepEqual(outlines[0], expected);
        assert.deepEqual(draws[0], ['door-image', ...expected]);
        editor.performDraw(x, y);
        editor.mouseGridPos = null;
        draws.length = 0;
        editor.render();
        assert.deepEqual(draws[0], ['door-image', ...expected]);
    }
});

test('erasing any of the four door cells stays erased after a save and load', () => {
    for (const [x, y] of [[4, 5], [5, 5], [4, 6], [5, 6]]) {
        const state = setup(), { editor, DataConverter } = state;
        editor.performDraw(4, 6);
        editor.performErase(x, y);
        assert.equal(editor.doorPos, null);
        const saved = encode(state);
        assert.ok(!saved.mapData.includes(0xFF), 'absence marker must not terminate the ROM header');
        editor.loadFromData(DataConverter.fromROMtoEditor(saved.mapData, saved.monsterData));
        assert.equal(editor.doorPos, null);
    }
});

test('door placement rejects clipped edges and accepts the lowest full row on either map width', () => {
    for (const wide of [false, true]) {
        const { editor, Config } = setup(wide);
        const width = wide ? Config.GRID_WIDTH : Config.GRID_WIDTH / 2;
        editor.performDraw(width - 2, Config.GRID_HEIGHT - 1);
        const position = { ...editor.doorPos };
        assert.deepEqual(position, { x: width - 2, y: Config.GRID_HEIGHT - 2 });
        for (const [x, y] of [[0, 0], [-1, 1], [width - 1, 1], [width, 1], [0, Config.GRID_HEIGHT]]) {
            assert.equal(editor.isProhibitedArea(x, y), true);
            editor.performDraw(x, y);
            assert.deepEqual(editor.doorPos, position);
        }
        if (wide) {
            editor.performDraw(15, 6);
            assert.deepEqual(editor.doorPos, { x: 15, y: 5 });
        }
    }
});

test('existing ROM door coordinates keep their original visual position', () => {
    for (const wide of [false, true]) {
        const { editor, DataConverter } = setup(wide);
        const original = [wide ? 16 : 0, 0x88, wide ? 20 : 8, 5];
        editor.loadFromData(DataConverter.fromROMtoEditor(original, [1]));
        assert.deepEqual(editor.doorPos, { x: original[2], y: original[3] });
    }
});

test('native ROM export keeps valid doors and does not send the editor absence marker to the game', () => {
    const { Config, Level, RomEditor, DataConverter } = setup();
    const romEditor = new RomEditor();
    romEditor.romData = new Uint8Array(0x10010);
    const absent = DataConverter.NO_DOOR_COORDINATE;
    romEditor.levels = [[0, 0], [8, 5], [absent, absent]].map(([x, y], i) =>
        new Level(i, 0, 0, [0, 0x88, x, y], [1]));
    romEditor.levelCount = romEditor.levels.length;
    const before = romEditor.exportLevelsData();
    const nativeROM = romEditor.getROMData();
    for (const [index, expected] of [[0, [0, 0]], [1, [8, 5]], [2, [0, 0]]]) {
        const address = romEditor.levels[index].romAddress;
        assert.deepEqual(Array.from(nativeROM.slice(address + 2, address + 4)), expected);
        const reader = new RomEditor();
        reader.romData = nativeROM;
        const decoded = DataConverter.fromROMtoEditor(reader.readLevelData(address), [1]);
        assert.deepEqual(decoded.door, { x: expected[0], y: expected[1] });
    }
    assert.deepEqual(romEditor.exportLevelsData(), before, 'export must not mutate saved project data');
    assert.equal(nativeROM[romEditor.levels[2].romAddress + 4], 0xFF);
    assert.equal(nativeROM.length, 0x10 + Config.PGR_PART_2_BANK_INDEX * 0x4000 + 0x4000);
});
