const assert = require('node:assert/strict');
const test = require('node:test');
const { LevelEditor, LevelCodec, EditorGrid, Enemy } = require('../helpers/source.cjs').load(
    ['LevelEditor', 'LevelCodec', 'EditorGrid', 'Enemy'],
    { document: { addEventListener() {}, getElementById() { return {}; } } }
);

function editorFromSaved(saved) {
    const editor = Object.create(LevelEditor.prototype);
    editor.mapData = Array.from({ length: EditorGrid.GRID_HEIGHT }, () => Array(EditorGrid.GRID_WIDTH).fill(0));
    editor.optimizedMapData = editor.mapData.map(row => [...row]);
    editor.updateButtonImages = editor.render = editor.resetImages = () => {};
    editor.loadFromData(LevelCodec.fromROMtoEditor(saved.mapData, saved.monsterData));
    return editor;
}

function save(editor) {
    return LevelCodec.fromLevelEditorToROMData(editor.getData(), editor.isWideScreen);
}

test('saved wide-screen sprites are excluded after switching to a single screen', () => {
    const editor = editorFromSaved({ mapData: [16, 0x48, 8, 8], monsterData: [1] });
    editor.enemies = [new Enemy(1, 0, 3), new Enemy(2, 15, 4),
        new Enemy(3, 16, 5), new Enemy(4, 31, 6)];
    const wide = save(editor);
    assert.deepEqual(wide.monsterData, [9, 1, 0x03, 2, 0xF4, 0x83, 0x05, 0x84, 0xF6]);

    // Reproduce saving in wide mode, reloading, then disabling wide mode.
    const reloaded = editorFromSaved(wide);
    reloaded.isWideScreen = false;
    const narrow = save(reloaded);
    assert.deepEqual(narrow.monsterData, [5, 1, 0x03, 2, 0xF4]);
    assert.equal(narrow.mapData[0], 0);
    assert.deepEqual(editorFromSaved(narrow).enemies.map(enemy => enemy.x), [0, 15]);

    // Serialization must not destroy the hidden editor contents.
    reloaded.isWideScreen = true;
    assert.deepEqual(save(reloaded).monsterData, wide.monsterData);
});

test('a single screen containing only hidden sprites saves an empty monster list', () => {
    const editor = editorFromSaved({ mapData: [16, 0x48, 8, 8], monsterData: [3, 0x83, 0x25] });
    editor.isWideScreen = false;
    assert.deepEqual(save(editor).monsterData, [1]);
    assert.equal(editor.enemies.length, 1);
});
