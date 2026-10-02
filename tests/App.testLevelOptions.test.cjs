const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function element() {
    const listeners = new Map(), attributes = new Map();
    return {
        listeners, attributes, dataset: {}, checked: false, hidden: true,
        textContent: '', focused: false,
        addEventListener(type, listener) { listeners.set(type, listener); },
        setAttribute(key, value) { attributes.set(key, value); },
        getAttribute(key) { return attributes.get(key); },
        focus() { this.focused = true; }
    };
}

function setup(saved = null) {
    const controls = new Map(['testLevelOptionsBtn', 'testLevelCameraFollowCheckbox',
        'testLevelSplitButton', 'testLevelOptionsMenu', 'testLevelOptionsIcon']
        .map(id => [id, element()]));
    controls.get('testLevelSplitButton').contains = target => [...controls.values()].includes(target);
    const listeners = new Map();
    const document = {
        getElementById(id) { return controls.get(id) || null; },
        addEventListener(type, listener) { listeners.set(type, listener); }
    };
    const storage = new Map(saved === null ? [] : [['moaikunTestLevelCameraFollow', saved]]);
    const localStorage = {
        getItem(key) { return storage.get(key) || null; },
        setItem(key, value) { storage.set(key, value); }
    };
    const source = ['Config', 'Level', 'RomFix', 'RomEditor', 'DataConverter', 'app']
        .map(name => fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8'))
        .join('\n');
    const { App, RomEditor, Config } = new Function('document', 'navigator', 'i18n', 'localStorage',
        `${source}\nreturn { App, RomEditor, Config };`)(document, { userAgent: '' },
        { t: key => key }, localStorage);
    const app = Object.create(App.prototype);
    app.testLevelCameraFollow = false;
    app.initTestLevelOptions();
    return { app, controls, listeners, storage, localStorage, RomEditor, Config };
}

test('preview options open by click or keyboard and close outside or on Escape', () => {
    const { app, controls, listeners } = setup();
    const toggle = controls.get('testLevelOptionsBtn');
    const checkbox = controls.get('testLevelCameraFollowCheckbox');
    const menu = controls.get('testLevelOptionsMenu');
    assert.equal(menu.hidden, true);
    toggle.listeners.get('click')();
    assert.equal(menu.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(checkbox.focused, true);
    listeners.get('click')({ target: checkbox });
    assert.equal(menu.hidden, false, 'clicks on the checkbox stay inside the panel');
    listeners.get('click')({ target: {} });
    assert.equal(menu.hidden, true);
    let prevented = false;
    toggle.listeners.get('keydown')({ key: 'ArrowDown', stopPropagation() {},
        preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(menu.hidden, false);
    listeners.get('keydown')({ key: 'Escape', preventDefault() {} });
    assert.equal(menu.hidden, true);
    assert.equal(toggle.focused, true);
    app.setTestLevelOptionsOpen(true);
    toggle.listeners.get('click')();
    assert.equal(menu.hidden, true, 'the arrow toggles an open panel closed');
});

test('preview controls keep keyboard input out of the running game while allowing editor shortcuts', () => {
    const { controls } = setup();
    for (const id of ['testLevelOptionsBtn', 'testLevelCameraFollowCheckbox']) {
        const control = controls.get(id);
        for (const key of ['Enter', ' ', 'x', 'ArrowLeft']) {
            let stopped = false, prevented = false;
            control.listeners.get('keydown')({ key,
                stopPropagation() { stopped = true; },
                preventDefault() { prevented = true; } });
            assert.equal(stopped, true, 'the emulator cannot read focused menu input');
            assert.equal(prevented, false, 'native button and checkbox activation remains available');
            stopped = false;
            control.listeners.get('keyup')({ stopPropagation() { stopped = true; } });
            assert.equal(stopped, true);
        }
        for (const [key, ctrlKey] of [['F5', false], ['F6', false], ['s', true]]) {
            let stopped = false;
            control.listeners.get('keydown')({ key, ctrlKey,
                stopPropagation() { stopped = true; } });
            assert.equal(stopped, false, 'editor shortcuts still reach the App listener');
        }
    }
});

test('preview checkbox persists its own setting and visibly marks the arrow', () => {
    const { app, controls, storage } = setup('true');
    const checkbox = controls.get('testLevelCameraFollowCheckbox');
    const toggle = controls.get('testLevelOptionsBtn');
    const icon = controls.get('testLevelOptionsIcon');
    app.romEditor = { getGameConfig() { throw new Error('preview must not touch export settings'); } };
    assert.equal(checkbox.checked, true);
    assert.equal(icon.textContent, '✓');
    assert.equal(toggle.dataset.cameraFollow, 'true');
    for (const enabled of [false, true]) {
        checkbox.checked = enabled;
        checkbox.listeners.get('change')();
        assert.equal(app.testLevelCameraFollow, enabled);
        assert.equal(icon.textContent, enabled ? '✓' : '›');
        assert.equal(toggle.dataset.cameraFollow, String(enabled));
        assert.equal(storage.get('moaikunTestLevelCameraFollow'), String(enabled));
        assert.equal(toggle.getAttribute('aria-label'),
            enabled ? 'testLevelOptionsFollowing' : 'testLevelOptionsNormal');
    }
});

test('preview selection remains usable when browser storage rejects writes', () => {
    const { app, controls, localStorage } = setup();
    localStorage.setItem = () => { throw new Error('storage unavailable'); };
    const checkbox = controls.get('testLevelCameraFollowCheckbox');
    checkbox.checked = true;
    assert.doesNotThrow(() => checkbox.listeners.get('change')());
    assert.equal(app.testLevelCameraFollow, true);
});

const romPath = process.env.MOAIKUN_TEST_ROM;
const original = romPath ? fs.readFileSync(romPath) : null;
test('quick level preview selects LOOP only for opted-in narrow maps without changing downloaded ROMs',
    { skip: !original }, async () => {
        for (const expanded of [false, true]) for (const exportFollow of [false, true]) {
            for (const wide of [false, true]) for (const previewFollow of [false, true]) {
                const { app, RomEditor, Config, controls } = setup();
                const editor = app.romEditor = new RomEditor();
                editor.loadROM(original);
                if (expanded) editor.romType = Config.ROM_TYPE_EXPANDED;
                editor.setGameConfig({ disableTimer: true, showRemainingRescueCount: false,
                    cameraFollow: exportFollow });
                const baseline = editor.getROMData(), settings = editor.getGameConfig();
                app.testLevelCameraFollow = previewFollow;
                app.levelEditor = { isWideScreen: wide };
                const map = Array.from({ length: 14 }, () => Array(wide ? 32 : 16).fill(0));
                map[12].fill(5);
                map[1][3] = 15;
                app.getLevelEditorData = () => ({ background: wide ? 16 : 0,
                    player: { x: 8, y: 11 }, door: { x: 11, y: 10 }, map, enemies: [] });
                app.changeMode = () => false;
                app.showMessage = () => {};
                app.testLevelBtn = {};
                app.saveBtn = {};
                app.testBtn = {};
                const calls = [];
                app.emulator = { loadROM(data) { calls.push(data); },
                    quickStart(options) { calls.push(options); } };
                app.setTestLevelOptionsOpen(true);
                await app.testLevel();
                const loopView = previewFollow && !wide;
                assert.deepEqual(calls[1], { loopView });
                const preview = calls[0], menuPointer = 0x86BB - 0x8000 + 16;
                const optionalMenu = preview.slice(menuPointer, menuPointer + 4)
                    .some((byte, i) => byte !== original[menuPointer + i]);
                assert.equal(optionalMenu, exportFollow || loopView,
                    'only the temporary ROM gains optional patches when preview needs them');
                assert.equal(controls.get('testLevelOptionsMenu').hidden, true);
                assert.deepEqual(editor.getGameConfig(), settings);
                assert.deepEqual(editor.getROMData(), baseline,
                    'normal export bytes remain identical after testing');
            }
        }
    });
