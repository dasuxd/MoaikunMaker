const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const controls = new Map(['disableTimerCheckbox', 'showNpcCountCheckbox', 'cameraFollowCheckbox']
    .map(id => [id, { checked: false }]));
controls.set('customLevelAuthorInput', { value: '', maxLength: 0 });
controls.set('customLevelAuthorLength', { textContent: '' });
const document = {
    addEventListener() {},
    getElementById(id) { return controls.get(id) ?? null; }
};
const source = ['Config', 'RomEditor', 'app']
    .map(name => fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8'))
    .join('\n');
const { App, RomEditor, Config } = new Function('document', 'navigator',
    `${source}\nreturn { App, RomEditor, Config };`)(document, { userAgent: '' });

test('new and cached game settings opt out of camera patches unless explicitly enabled', () => {
    const editor = new RomEditor();
    assert.equal(editor.getGameConfig().cameraFollow, false);
    editor.setGameConfig({ disableTimer: true, showRemainingRescueCount: false });
    assert.deepEqual(editor.getGameConfig(), {
        disableTimer: true, showRemainingRescueCount: false, cameraFollow: false, customLevelAuthor: ''
    });
    editor.setGameConfig({ ...editor.getGameConfig(), cameraFollow: true });
    const cached = JSON.parse(JSON.stringify(editor.getGameConfig()));
    const restored = new RomEditor();
    restored.setGameConfig(cached);
    assert.deepEqual(restored.getGameConfig(), cached);
    const detached = restored.getGameConfig();
    detached.cameraFollow = false;
    assert.equal(restored.getGameConfig().cameraFollow, true);
});

test('camera checkbox follows settings and saves both enabling and disabling without losing other options', () => {
    const app = Object.create(App.prototype);
    app.romEditor = new RomEditor();
    app.romEditor.romData = new Uint8Array(16);
    app.romEditor.setGameConfig({ disableTimer: true, showRemainingRescueCount: false });
    const saved = [];
    app.saveLevelDataToCache = () => saved.push(app.romEditor.getGameConfig());
    app.syncGameConfigControls();
    assert.equal(controls.get('cameraFollowCheckbox').checked, false);
    for (const enabled of [true, false]) {
        app.updateGameConfig('cameraFollow', enabled);
        assert.equal(controls.get('cameraFollowCheckbox').checked, enabled);
        assert.equal(controls.get('disableTimerCheckbox').checked, true);
        assert.equal(controls.get('showNpcCountCheckbox').checked, false);
        assert.deepEqual(saved.at(-1), {
            disableTimer: true, showRemainingRescueCount: false, cameraFollow: enabled, customLevelAuthor: ''
        });
    }
    assert.equal(saved.length, 2);
});

test('author accepts only ASCII letters/spaces, limits the rendered width and survives cached settings', () => {
    const app = Object.create(App.prototype);
    app.romEditor = new RomEditor();
    app.romEditor.romData = new Uint8Array(16);
    const saved = [];
    app.saveLevelDataToCache = () => saved.push(JSON.parse(JSON.stringify(app.romEditor.getGameConfig())));
    app.updateGameConfig('customLevelAuthor', 'Map 作者 Jane-123\nDoe');
    assert.equal(app.romEditor.getGameConfig().customLevelAuthor, 'Map  JaneDoe');
    assert.equal(controls.get('customLevelAuthorInput').value, 'Map  JaneDoe');
    assert.equal(controls.get('customLevelAuthorInput').maxLength, 28);
    assert.equal(controls.get('customLevelAuthorLength').textContent, '12/28');
    const restored = new RomEditor();
    restored.setGameConfig(saved.at(-1));
    assert.equal(restored.getGameConfig().customLevelAuthor, 'Map  JaneDoe');
    app.updateGameConfig('customLevelAuthor', 'A'.repeat(100));
    assert.equal(app.romEditor.getGameConfig().customLevelAuthor.length, Config.CUSTOM_LEVEL_AUTHOR_MAX_LENGTH);
    assert.equal(controls.get('customLevelAuthorLength').textContent, '28/28');
    app.updateGameConfig('customLevelAuthor', '');
    assert.equal(saved.at(-1).customLevelAuthor, '');
});
