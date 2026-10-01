const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');

const document = { addEventListener() {} };
const appSource = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const App = new Function('document', 'navigator', `${appSource}\nreturn App;`)(
    document, { userAgent: '' }
);

test('cancelled toolbar touches remove the scroll-blocking drag listener', () => {
    const toolbarListeners = {};
    const listeners = new Map();
    const toolbar = {
        style: {}, classList: { contains: () => true },
        addEventListener(type, listener) { toolbarListeners[type] = listener; },
        getBoundingClientRect: () => ({ left: 10, top: 10 })
    };
    const doc = {
        getElementById: () => toolbar,
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); }
    };
    const win = { addEventListener() {} };
    const DragApp = new Function('document', 'window', `${appSource}\nreturn App;`)(doc, win);
    Object.create(DragApp.prototype).initToolbarDragging();
    assert.equal(listeners.has('touchmove'), false);
    toolbarListeners.touchstart({ type: 'touchstart', target: { closest: () => null },
        touches: [{ clientX: 20, clientY: 30 }] });
    assert.equal(listeners.has('touchmove'), true);
    listeners.get('touchcancel')();
    assert.equal(listeners.has('touchmove'), false);
    assert.equal(listeners.has('touchcancel'), false);
    assert.equal(toolbar.style.cursor, '');
});

function makeButton() {
    return {
        disabled: false,
        clicks: 0,
        click() { this.clicks++; }
    };
}

function press(app, key, options = {}) {
    let prevented = false;
    app.handleKeyboardShortcut({
        key,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        repeat: false,
        preventDefault() { prevented = true; },
        ...options
    });
    return prevented;
}

test('editor shortcuts click their buttons only when enabled', () => {
    const app = Object.create(App.prototype);
    app.testLevelBtn = makeButton();
    app.stopEmulatorBtn = makeButton();
    app.saveBtn = makeButton();

    assert.equal(press(app, 'F5'), true);
    assert.equal(press(app, 'F6'), true);
    assert.equal(press(app, 's', { ctrlKey: true }), true);
    assert.equal(app.testLevelBtn.clicks, 1);
    assert.equal(app.stopEmulatorBtn.clicks, 1);
    assert.equal(app.saveBtn.clicks, 1);

    app.testLevelBtn.disabled = true;
    app.stopEmulatorBtn.disabled = true;
    app.saveBtn.disabled = true;
    assert.equal(press(app, 'F5'), true);
    assert.equal(press(app, 'F6'), true);
    assert.equal(press(app, 'S', { ctrlKey: true }), true);
    assert.equal(app.testLevelBtn.clicks, 1);
    assert.equal(app.stopEmulatorBtn.clicks, 1);
    assert.equal(app.saveBtn.clicks, 1);
});

test('shortcut modifiers and held keys do not trigger extra actions', () => {
    const app = Object.create(App.prototype);
    app.testLevelBtn = makeButton();
    app.stopEmulatorBtn = makeButton();
    app.saveBtn = makeButton();

    assert.equal(press(app, 'F5', { shiftKey: true }), false);
    assert.equal(press(app, 'F6', { ctrlKey: true }), false);
    assert.equal(press(app, 's'), false);
    assert.equal(press(app, 's', { metaKey: true }), false);
    assert.equal(press(app, 's', { ctrlKey: true, repeat: true }), true);
    assert.equal(app.testLevelBtn.clicks, 0);
    assert.equal(app.stopEmulatorBtn.clicks, 0);
    assert.equal(app.saveBtn.clicks, 0);
});

test('Ctrl+S does not also press the emulator down button', () => {
    const emulatorSource = fs.readFileSync(path.join(__dirname, '../js/NesEmulator.js'), 'utf8');
    const listeners = {};
    const emulatorDocument = {
        addEventListener(name, listener) { listeners[name] = listener; }
    };
    const emulatorApp = { testMode: true, mobileController: {} };
    const NesEmulator = new Function(
        'jsnes', 'app', 'document',
        `${emulatorSource}\nreturn NesEmulator;`
    )(jsnes, emulatorApp, emulatorDocument);
    const emulator = Object.create(NesEmulator.prototype);
    const pressed = [];
    emulator.isRunning = true;
    emulator.buttonDown = (player, button) => pressed.push({ player, button });
    emulator.setupKeyboard();

    let prevented = false;
    listeners.keydown({
        key: 's', ctrlKey: true, metaKey: false, altKey: false,
        preventDefault() { prevented = true; }
    });
    assert.equal(prevented, false);
    assert.deepEqual(pressed, []);

    listeners.keydown({
        key: 's', ctrlKey: false, metaKey: false, altKey: false,
        preventDefault() { prevented = true; }
    });
    assert.deepEqual(pressed, [{ player: 1, button: jsnes.Controller.BUTTON_DOWN }]);
});
