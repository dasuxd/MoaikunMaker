const assert = require('node:assert/strict');
const test = require('node:test');

const controls = new Map(['disableTimerCheckbox', 'showNpcCountCheckbox', 'cameraFollowCheckbox']
    .map(id => [id, { checked: false }]));
controls.set('customLevelAuthorInput', { value: '', maxLength: 0 });
controls.set('customLevelAuthorLength', { textContent: '' });
const document = {
    addEventListener() {},
    getElementById(id) { return controls.get(id) ?? null; }
};
const { App, Project, GameSettings } = require('../helpers/source.cjs').load(['App', 'Project', 'GameSettings'], {document});
test('new and cached game settings opt out of camera patches unless explicitly enabled', () => {
    const editor = new Project();
    assert.equal(editor.getGameConfig().cameraFollow, false);
    editor.setGameConfig({ disableTimer: true, showRemainingRescueCount: false });
    assert.deepEqual(editor.getGameConfig(), {
        disableTimer: true, showRemainingRescueCount: false, cameraFollow: false, customLevelAuthor: ''
    });
    editor.setGameConfig({ ...editor.getGameConfig(), cameraFollow: true });
    const cached = JSON.parse(JSON.stringify(editor.getGameConfig()));
    const restored = new Project();
    restored.setGameConfig(cached);
    assert.deepEqual(restored.getGameConfig(), cached);
    const detached = restored.getGameConfig();
    detached.cameraFollow = false;
    assert.equal(restored.getGameConfig().cameraFollow, true);
});

test('camera checkbox follows settings and saves both enabling and disabling without losing other options', () => {
    const app = Object.create(App.prototype);
    app.project = new Project();
    app.project.romData = new Uint8Array(16);
    app.project.setGameConfig({ disableTimer: true, showRemainingRescueCount: false });
    const saved = [];
    app.loader = {saveLevelDataToCache: () => saved.push(app.project.getGameConfig())};
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
    app.project = new Project();
    app.project.romData = new Uint8Array(16);
    const saved = [];
    app.loader = {saveLevelDataToCache: () => saved.push(app.project.getGameConfig())};
    app.updateGameConfig('customLevelAuthor', 'Map 作者 Jane-123\nDoe');
    assert.equal(app.project.getGameConfig().customLevelAuthor, 'Map  JaneDoe');
    assert.equal(controls.get('customLevelAuthorInput').value, 'Map  JaneDoe');
    assert.equal(controls.get('customLevelAuthorInput').maxLength, 28);
    assert.equal(controls.get('customLevelAuthorLength').textContent, '12/28');
    const restored = new Project();
    restored.setGameConfig(saved.at(-1));
    assert.equal(restored.getGameConfig().customLevelAuthor, 'Map  JaneDoe');
    app.updateGameConfig('customLevelAuthor', 'A'.repeat(100));
    assert.equal(app.project.getGameConfig().customLevelAuthor.length, GameSettings.CUSTOM_LEVEL_AUTHOR_MAX_LENGTH);
    assert.equal(controls.get('customLevelAuthorLength').textContent, '28/28');
    app.updateGameConfig('customLevelAuthor', '');
    assert.equal(saved.at(-1).customLevelAuthor, '');
});
