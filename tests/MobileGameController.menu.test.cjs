const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');
const source = fs.readFileSync(path.join(__dirname, '../js/MobileGameController.js'), 'utf8');

function fixture({ saved = false, paused = false, pointerEvents = true } = {}) {
    const elements = new Map();
    const documentListeners = {};
    const windowListeners = {};
    const document = { activeElement: null, addEventListener(type, listener) { documentListeners[type] = listener; },
        getElementById: id => element(id) };
    function element(id) {
        if (!elements.has(id)) {
            const classes = new Set();
            const listeners = {};
            const listenerOptions = {};
            elements.set(id, {
                hidden: false, disabled: false, inert: false, style: {}, textContent: '',
                listenerOptions,
                classList: { add: x => classes.add(x), remove: x => classes.delete(x),
                    contains: x => classes.has(x), toggle: (x, value) => value ? classes.add(x) : classes.delete(x) },
                addEventListener: (type, callback, options) => {
                    listeners[type] = callback;
                    listenerOptions[type] = options;
                },
                setAttribute(name, value) { this[name] = value; },
                getAttribute(name) { return name === 'data-key' ? (id === 'gameLeft' ? 'left' : 'a') : this[name]; },
                focus() { document.activeElement = this; },
                click() { if (!this.disabled) listeners.click?.({ target: this }); },
                dispatch(type, event) { listeners[type]?.(event); },
                contains(target) { return target === this; },
                setPointerCapture(id) { this.capturedPointer = id; },
                closest() { return null; },
                querySelectorAll(selector) {
                    if (selector === '[data-key]') return [element('gameLeft'), element('gameA')];
                    return [element('left'), element('right')];
                }
            });
        }
        return elements.get(id);
    }
    const calls = { saves: 0, loads: 0, stops: 0, downs: 0, ups: 0, resumes: 0 };
    const emulator = {
        nes: {}, isRunning: true, isPaused: paused,
        quickSaveSlots: [saved ? { progress: 1 } : null, null, null, null],
        buttonDown() { calls.downs++; }, buttonUp() { calls.ups++; },
        pause() { this.isPaused = true; },
        resume() { calls.resumes++; if (this.isRunning) this.isPaused = false; },
        quickSave(slot) { calls.saves++; this.quickSaveSlots[slot - 1] = { progress: 2 }; return true; },
        quickLoad() { calls.loads++; return true; },
        recenterGameView() {}
    };
    const app = { vibrate() {}, testLevelBtn: element('testLevelBtn'), stopEmulator() {
        calls.stops++;
        emulator.isRunning = false;
        emulator.isPaused = false;
        emulator.quickSaveSlots.fill(null);
        controller.hide();
    } };
    const Controller = new Function('document', 'window', 'jsnes', 'app', 'i18n', `${source}\nreturn MobileGameController;`)(
        document, { PointerEvent: pointerEvents ? function() {} : undefined,
            addEventListener(type, listener) { windowListeners[type] = listener; } }, jsnes, app, { t: key => key }
    );
    const controller = new Controller(emulator);
    controller.show();
    return { controller, emulator, calls, element, document, documentListeners, windowListeners };
}

test('opening the menu releases held buttons and closing resumes only its own pause', () => {
    const f = fixture();
    f.controller.handleButtonDown('a', f.element('gameA'));
    f.element('mobileMenuToggle').click();
    assert.equal(f.emulator.isPaused, true);
    assert.equal(f.calls.ups, 1);
    assert.equal(f.element('left').inert, true);
    assert.equal(f.element('tools').inert, false);
    f.controller.handleButtonDown('a', f.element('gameA'));
    assert.equal(f.calls.downs, 1);
    assert.equal(f.element('mobileQuickLoadBtn').disabled, true);
    f.element('mobileMenuClose').click();
    assert.equal(f.emulator.isPaused, false);
    assert.equal(f.element('left').inert, false);

    const alreadyPaused = fixture({ paused: true });
    alreadyPaused.controller.openMenu();
    alreadyPaused.controller.closeMenu();
    assert.equal(alreadyPaused.emulator.isPaused, true);
    assert.equal(alreadyPaused.calls.resumes, 0);
});

test('the list toggles and dismisses outside without trapping Tab or cancelling scrolling', () => {
    const f = fixture();
    f.element('mobileMenuToggle').click();
    let prevented = false;
    f.controller.handleMenuKey({ key: 'Tab', preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
    f.documentListeners.pointerdown({ target: f.element('page'), preventDefault() { prevented = true; } });
    assert.equal(f.controller.menuOpen, false);
    assert.equal(f.emulator.isPaused, false);
    assert.equal(prevented, false);
    f.element('mobileMenuToggle').click();
    f.element('mobileMenuToggle').click();
    assert.equal(f.controller.menuOpen, false);
});

test('pointer capture releases on cancellation, outside release and loss of focus', () => {
    const f = fixture();
    const button = f.element('gameA');
    const press = id => button.dispatch('pointerdown', {
        pointerId: id, pointerType: 'touch', cancelable: true, preventDefault() {}
    });
    press(10);
    press(11);
    assert.equal(f.calls.downs, 1);
    assert.equal(button.capturedPointer, 11);
    button.dispatch('pointercancel', { pointerId: 10 });
    assert.equal(f.calls.ups, 0); // second finger still holds the same button
    f.windowListeners.pointerup({ pointerId: 11 });
    assert.equal(f.calls.ups, 1);
    button.dispatch('lostpointercapture', { pointerId: 11 });
    assert.equal(f.calls.ups, 1);
    press(12);
    f.windowListeners.blur();
    assert.equal(f.calls.ups, 2);
    assert.equal(f.controller.pressedPointers.size, 0);
    press(13);
    f.document.hidden = true;
    f.documentListeners.visibilitychange();
    assert.equal(f.calls.ups, 3);
});

test('legacy touch fallback holds independent touches until their matching release', () => {
    const f = fixture({ pointerEvents: false });
    const button = f.element('gameA');
    let prevented = 0;
    const touchEvent = ids => ({ changedTouches: ids.map(identifier => ({ identifier })),
        cancelable: true, preventDefault() { prevented++; } });
    button.dispatch('touchstart', touchEvent([4, 5]));
    button.dispatch('touchend', touchEvent([4]));
    assert.equal(f.calls.ups, 0);
    button.dispatch('touchcancel', touchEvent([5]));
    assert.equal(f.calls.ups, 1);
    assert.equal(prevented, 3);
    button.dispatch('mousedown', { button: 0, preventDefault() {} });
    assert.equal(f.calls.downs, 1); // no duplicate compatibility mouse event
});

for (const pointerEvents of [true, false]) {
    const input = pointerEvents ? 'pointer' : 'legacy touch';

    test(`${input}: native touch guards cover both panels without generating game input`, () => {
        const f = fixture({ pointerEvents });
        for (const id of ['left', 'right']) {
            const panel = f.element(id);
            for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
                assert.deepEqual(panel.listenerOptions[type], { passive: false, capture: true });
                let prevented = false;
                // A touch on panel padding has no game key or changedTouches.
                panel.dispatch(type, { cancelable: true, preventDefault() { prevented = true; } });
                assert.equal(prevented, true);
                panel.dispatch(type, { cancelable: false, preventDefault() { assert.fail('not cancelable'); } });
            }
        }
        assert.equal(f.calls.downs, 0);
        assert.equal(f.controller.pressedPointers.size, 0);
        assert.equal(f.element('mobileMenuToggle').listenerOptions.touchstart, undefined);
        assert.equal(f.element('mobileEmulatorMenu').listenerOptions.touchmove, undefined);
        assert.equal(f.documentListeners.touchmove, undefined);
    });

    test(`${input}: holding either side survives two taps on the other side`, () => {
        for (const holdLeft of [true, false]) {
            const f = fixture({ pointerEvents });
            const held = f.element(holdLeft ? 'gameLeft' : 'gameA');
            const tapped = f.element(holdLeft ? 'gameA' : 'gameLeft');
            const heldPanel = f.element(holdLeft ? 'left' : 'right');
            const tappedPanel = f.element(holdLeft ? 'right' : 'left');
            const heldKey = holdLeft ? 'left' : 'a';
            let prevented = 0;
            const touch = id => ({ cancelable: true,
                changedTouches: [{ identifier: id }], preventDefault() { prevented++; } });
            const dispatch = (button, panel, type, id) => {
                const touchType = type === 'down' ? 'touchstart' : 'touchend';
                const event = touch(id);
                if (pointerEvents) {
                    button.dispatch(`pointer${type}`, { pointerId: id, pointerType: 'touch',
                        cancelable: true, preventDefault() {} });
                }
                // Native touch capture at the panel then delivery to the button.
                panel.dispatch(touchType, event);
                button.dispatch(touchType, event);
            };
            dispatch(held, heldPanel, 'down', 10);
            for (const id of [11, 12]) {
                dispatch(tapped, tappedPanel, 'down', id);
                assert.equal(f.controller.activeButtons.size, 2);
                dispatch(tapped, tappedPanel, 'up', id);
                assert.deepEqual([...f.controller.activeButtons], [heldKey]);
                assert.equal(f.controller.pressedPointers.size, 1);
                assert.equal(held.style.opacity, '0.7');
            }
            dispatch(held, heldPanel, 'up', 10);
            assert.equal(f.calls.downs, 3);
            assert.equal(f.calls.ups, 3);
            assert.equal(f.controller.activeButtons.size, 0);
            assert.equal(f.controller.pressedPointers.size, 0);
            assert.equal(prevented, pointerEvents ? 6 : 12);
        }
    });
}

test('first save is immediate, but an existing save survives cancellation of overwrite', () => {
    const f = fixture();
    f.controller.openMenu();
    f.element('mobileQuickSaveBtn').click();
    assert.equal(f.calls.saves, 1);
    assert.equal(f.controller.menuOpen, false);
    f.controller.openMenu();
    const saved = f.emulator.quickSaveSlots[0];
    f.element('mobileQuickSaveBtn').click();
    assert.equal(f.calls.saves, 1);
    assert.equal(f.element('mobileMenuConfirmation').hidden, false);
    assert.equal(f.document.activeElement, f.element('mobileConfirmCancel'));
    f.element('mobileConfirmCancel').click();
    assert.equal(f.emulator.quickSaveSlots[0], saved);
    assert.equal(f.emulator.isPaused, true);
    f.element('mobileQuickSaveBtn').click();
    f.element('mobileConfirmAccept').click();
    f.element('mobileConfirmAccept').click();
    assert.equal(f.calls.saves, 2);
    assert.equal(f.emulator.isPaused, false);
});

test('load waits for confirmation and a failed load leaves the menu paused', () => {
    const f = fixture({ saved: true });
    f.controller.openMenu();
    f.element('mobileQuickLoadBtn').click();
    assert.equal(f.calls.loads, 0);
    f.element('mobileConfirmCancel').click();
    assert.equal(f.calls.loads, 0);
    f.element('mobileQuickLoadBtn').click();
    f.emulator.quickLoad = () => false;
    f.element('mobileConfirmAccept').click();
    assert.equal(f.controller.menuOpen, true);
    assert.equal(f.emulator.isPaused, true);
    f.emulator.quickLoad = () => { f.calls.loads++; return true; };
    f.element('mobileQuickLoadBtn').click();
    f.element('mobileConfirmAccept').click();
    assert.equal(f.calls.loads, 1);
    assert.equal(f.emulator.isPaused, false);
});

test('stop cancellation retains saves; confirmation stops once without resuming', () => {
    const f = fixture({ saved: true });
    f.controller.openMenu();
    f.element('mobileStopBtn').click();
    assert.equal(f.calls.stops, 0);
    f.element('mobileConfirmCancel').click();
    assert.ok(f.emulator.quickSaveSlots[0]);
    f.element('mobileStopBtn').click();
    f.element('mobileConfirmAccept').click();
    f.element('mobileConfirmAccept').click();
    assert.equal(f.calls.stops, 1);
    assert.equal(f.calls.resumes, 0);
    assert.equal(f.emulator.isRunning, false);
    assert.equal(f.element('mobileEmulatorMenu').hidden, true);
    assert.equal(f.element('left').inert, false);
    assert.ok(f.emulator.quickSaveSlots.every(slot => slot === null));
});

test('Escape cancels confirmation before closing, and external hide restores input', () => {
    const f = fixture({ saved: true });
    f.controller.openMenu();
    f.element('mobileStopBtn').click();
    const escape = { key: 'Escape', preventDefault() {} };
    f.controller.handleMenuKey(escape);
    assert.equal(f.controller.menuOpen, true);
    assert.equal(f.controller.pendingAction, null);
    f.controller.handleMenuKey(escape);
    assert.equal(f.controller.menuOpen, false);
    f.controller.openMenu();
    f.controller.hide();
    assert.equal(f.emulator.isPaused, false);
    assert.equal(f.element('mobileEmulatorMenu').hidden, true);
    assert.equal(f.element('tools').inert, false);
});
