const assert = require('node:assert/strict');
const test = require('node:test');

const {EditorGrid, GraphicsCatalog, LevelCanvas, Enemy, LevelEditor} = require('../helpers/source.cjs').load(
    ['EditorGrid', 'GraphicsCatalog', 'LevelCanvas', 'Enemy', 'LevelEditor'],
    {document: {addEventListener() {}, getElementById() {return {};}}});
test('the 2x2 exit and its surrounding ring exclude portal placement in either order', () => {
    for (const wide of [false, true]) {
        const e = Object.create(LevelEditor.prototype);
        e.isWideScreen = wide; e._currentBgId = '0'; e.currentTileId = null;
        e.currentTool = 'enemy'; e.currentEnemyId = 0x3D; e.doorPos = {x: 0, y: 4};
        const width = wide ? 32 : 16;
        for (const x of [width - 1, 0, 1, 2]) for (const y of [3, 4, 5, 6])
            assert.ok(e.isProhibitedArea(x, y));
        assert.equal(e.isProhibitedArea(3, 5), false);
        e.currentTool = 'door'; e.enemies = [new Enemy(13, width - 1, 3)];
        assert.ok(e.isProhibitedArea(0, 5));
        assert.equal(e.isProhibitedArea(1, 5), false);
    }
});

test('portal pair numbers can be edited even when all eight object slots are occupied', () => {
    const editor = Object.create(LevelEditor.prototype);
    editor.currentTool = 'enemy'; editor.currentEnemyId = 13;
    editor.isProhibitedArea = () => false; editor.performEnd = () => {};
    editor.enemies = Array.from({length: 8}, (_, i) => new Enemy(13, i + 2, 7));
    editor.performDraw(2, 7, false);
    assert.equal(editor.enemies[0].getPortalPairId(), 2);
    assert.equal(editor.currentEnemyId, 0x1D);
    assert.equal(editor.enemies.length, 8);
    editor.enemies.pop(); editor.performDraw(16, 7, false);
    assert.equal(editor.enemies[7].enemyId, 0x9D);
});

test('enemy toolbar includes the restored bird/fish as one 16x16 type', () => {
    const editor = Object.create(LevelEditor.prototype);
    editor.enemyBtns = [];
    editor.createButton = (type, container, alt, id) => ({ type, id });
    editor.createEnemyButtons();
    assert.deepEqual(editor.enemyBtns.map(button => button.id),
        Array.from({ length: 13 }, (_, index) => index + 1));
    assert.equal(GraphicsCatalog.RESOURCE_IMG_CONFIG.enemy_12.imgBlockIndex.length, 2);
    assert.equal(GraphicsCatalog.RESOURCE_IMG_CONFIG.enemy_12.imgBlockIndex[0].length, 2);
});

test('portal previews select pair and coverage artwork without mirroring numerals', () => {
    const images = new Map(), drawn = [];
    const ctx = {save() {}, restore() {}, drawImage(img) {drawn.push(img);},
        translate() {assert.fail('portal should not mirror');}, scale() {assert.fail('portal should not mirror');}};
    for (let group = 1; group <= 4; group++) for (const covered of [false, true]) {
        const key = `enemy_13_pair_${group}${covered ? '_covered' : ''}`;
        images.set(key, key);
        for (const facing of [0, 0x40]) {
            LevelCanvas.drawEnemy(new Enemy(13 | ((group - 1) << 4) | facing, 2, 7), ctx, images, covered);
            assert.equal(drawn.pop(), key);
        }
    }
});

test('changing scenes cannot leave a selected bird/fish or boss tool placeable in an incompatible scene', () => {
    const editor = Object.create(LevelEditor.prototype);
    editor.currentTool = 'enemy';
    editor.currentTileId = null;
    for (let scene = 0; scene < EditorGrid.LEVEL_TYPE_COUNT; scene++) {
        // Bypass the setter: these checks only need the selected scene value.
        editor._currentBgId = String(scene);
        const castle = scene === 7 || scene === 8;
        for (const flags of [0, 0x40, 0x80, 0xC0]) {
            editor.currentEnemyId = 12 | flags;
            assert.equal(editor.isProhibitedArea(5, 5), castle,
                `bird/fish scene ${scene}, flags ${flags}`);
            editor.currentEnemyId = 7 | flags;
            assert.equal(editor.isProhibitedArea(5, 5), !castle,
                `boss scene ${scene}, flags ${flags}`);
        }
    }
});
