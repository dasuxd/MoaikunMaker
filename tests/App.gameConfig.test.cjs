const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const controls = new Map(['disableTimerCheckbox', 'showNpcCountCheckbox', 'cameraFollowCheckbox']
    .map(id => [id, { checked: false }]));
const document = {
    addEventListener() {},
    getElementById(id) { return controls.get(id) ?? null; }
};
const source = ['Config', 'RomEditor', 'app']
    .map(name => fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8'))
    .join('\n');
const { App, RomEditor } = new Function('document', 'navigator',
    `${source}\nreturn { App, RomEditor };`)(document, { userAgent: '' });

test('new and cached game settings opt out of camera patches unless explicitly enabled', () => {
    const editor = new RomEditor();
    assert.equal(editor.getGameConfig().cameraFollow, false);
    editor.setGameConfig({ disableTimer: true, showRemainingRescueCount: false });
    assert.deepEqual(editor.getGameConfig(), {
        disableTimer: true, showRemainingRescueCount: false, cameraFollow: false
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
            disableTimer: true, showRemainingRescueCount: false, cameraFollow: enabled
        });
    }
    assert.equal(saved.length, 2);
});
