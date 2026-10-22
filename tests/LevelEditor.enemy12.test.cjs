const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = ['Config', 'Enemy', 'LevelEditor']
    .map(name => fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8'))
    .join('\n');
const { Config, LevelEditor } = new Function('document',
    `${source}\nreturn { Config, LevelEditor };`)(
    { getElementById() { return {}; } });

test('enemy toolbar includes the restored bird/fish as one 16x16 type', () => {
    const editor = Object.create(LevelEditor.prototype);
    editor.enemyBtns = [];
    editor.createButton = (type, container, alt, id) => ({ type, id });
    editor.createEnemyButtons();
    assert.deepEqual(editor.enemyBtns.map(button => button.id),
        Array.from({ length: 12 }, (_, index) => index + 1));
    assert.equal(Config.RESOURCE_IMG_CONFIG.enemy_12.imgBlockIndex.length, 2);
    assert.equal(Config.RESOURCE_IMG_CONFIG.enemy_12.imgBlockIndex[0].length, 2);
});

test('changing scenes cannot leave a selected bird/fish or boss tool placeable in an incompatible scene', () => {
    const editor = Object.create(LevelEditor.prototype);
    editor.currentTool = 'enemy';
    editor.currentTileId = null;
    for (let scene = 0; scene < Config.LEVEL_TYPE_COUNT; scene++) {
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
