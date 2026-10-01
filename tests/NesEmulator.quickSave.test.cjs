const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');

const messages = [];
const app = {
    testMode: true,
    mobileController: {},
    showMessage(type, message) { messages.push({ type, message }); }
};
const i18n = { t: (key, { slot } = {}) => `${key}:${slot}` };
const document = {
    listeners: {},
    addEventListener(name, listener) { this.listeners[name] = listener; }
};

const source = fs.readFileSync(path.join(__dirname, '../js/NesEmulator.js'), 'utf8');
const NesEmulator = new Function(
    'jsnes', 'app', 'i18n', 'document',
    `${source}\nreturn NesEmulator;`
)(jsnes, app, i18n, document);

function makeRom(mapper = 0) {
    // Minimal synthetic program: JMP $8000, with all vectors at $8000.
    const prgBanks = mapper === 0 ? 1 : 2;
    const rom = new Uint8Array(16 + prgBanks * 16384 + 8192);
    rom.set([0x4e, 0x45, 0x53, 0x1a, prgBanks, 1, mapper << 4]);
    rom.set([0x4c, 0x00, 0x80], 16);
    rom.set([0x00, 0x80, 0x00, 0x80, 0x00, 0x80], 16 + prgBanks * 16384 - 6);
    return rom;
}

function makeEmulator(mapper = 0) {
    const emulator = Object.create(NesEmulator.prototype);
    emulator.quickSaveSlots = Array(NesEmulator.QUICK_SAVE_SLOT_COUNT).fill(null);
    emulator.runGeneration = 0;
    emulator.isRunning = true;
    emulator.audioBufferSize = 4096;
    emulator.audioCapacity = 8192;
    emulator.audioSamples = new Float32Array(emulator.audioCapacity * 2);
    emulator.clearAudioBuffer();
    emulator.audioContext = {};
    emulator.handleAudioSample(1, 1);
    emulator.nes = new jsnes.NES({ onFrame() {}, onAudioSample() {} });
    emulator.loadROM(makeRom(mapper));
    emulator.nes.frame();
    return emulator;
}

test('four slots retain independent snapshots across repeated loads', () => {
    const emulator = makeEmulator();
    emulator.nes.cpu.mem[0x10] = 12;
    emulator.quickSave(1);
    emulator.nes.cpu.mem[0x10] = 23;
    emulator.quickSave(2);
    emulator.quickLoad(1);
    assert.equal(emulator.nes.cpu.mem[0x10], 12);
    emulator.nes.cpu.mem[0x10] = 44;
    emulator.quickLoad(1);
    assert.equal(emulator.nes.cpu.mem[0x10], 12);
    emulator.quickLoad(2);
    assert.equal(emulator.nes.cpu.mem[0x10], 23);
    assert.equal(emulator.audioCount, 0);
    assert.ok(emulator.nes.controllers[1].state.every(value => value === 64));
});

test('quick load restores the original and expanded ROM mapper states', () => {
    for (const mapper of [2, 3]) {
        const emulator = makeEmulator(mapper);
        emulator.nes.cpu.mem[0x10] = 31;
        emulator.quickSave(1);
        emulator.nes.cpu.mem[0x10] = 99;
        emulator.quickLoad(1);
        assert.equal(emulator.nes.cpu.mem[0x10], 31, `mapper ${mapper}`);
        emulator.nes.frame();
        emulator.quickLoad(1);
        assert.equal(emulator.nes.cpu.mem[0x10], 31, `repeated mapper ${mapper} load`);
    }
});

test('shortcut handling is limited to running test mode', () => {
    const emulator = makeEmulator();
    emulator.setupKeyboard();
    const press = (key, shiftKey = false, extra = {}) => {
        let prevented = false;
        document.listeners.keydown({
            key, shiftKey, repeat: false, ctrlKey: false, altKey: false,
            metaKey: false, target: {},
            preventDefault() { prevented = true; }, ...extra
        });
        return prevented;
    };
    assert.equal(press('F3'), true);
    assert.equal(messages.at(-1).message, 'quickSaveEmpty:3');
    emulator.nes.cpu.mem[0x10] = 77;
    assert.equal(press('F3', true), true);
    emulator.nes.cpu.mem[0x10] = 88;
    assert.equal(press('F3'), true);
    assert.equal(emulator.nes.cpu.mem[0x10], 77);
    assert.equal(press('F3', true, { repeat: true }), true);
    assert.equal(press('F3', false, { target: { tagName: 'INPUT' } }), true);
    assert.equal(press('F3', false, { ctrlKey: true }), false);
    assert.equal(press('F3', false, { altKey: true }), false);
    assert.equal(press('Alt'), true);
    assert.equal(emulator.nes.controllers[1].state[jsnes.Controller.BUTTON_SELECT], 65);
    let altKeyUpPrevented = false;
    document.listeners.keyup({
        key: 'Alt',
        preventDefault() { altKeyUpPrevented = true; }
    });
    assert.equal(altKeyUpPrevented, true);
    assert.equal(emulator.nes.controllers[1].state[jsnes.Controller.BUTTON_SELECT], 64);
    assert.equal(press('Shift'), false);
    assert.equal(emulator.nes.controllers[1].state[jsnes.Controller.BUTTON_SELECT], 64);
    app.testMode = false;
    assert.equal(press('F3'), false);
    app.testMode = true;
    emulator.stop();
    assert.equal(press('F3'), false);
});

test('slots clear on stop and ROM replacement', () => {
    const emulator = makeEmulator();
    emulator.quickSave(4);
    emulator.stop();
    assert.ok(emulator.quickSaveSlots.every(slot => slot === null));
    emulator.isRunning = true;
    emulator.quickSave(4);
    emulator.loadROM(makeRom());
    assert.ok(emulator.quickSaveSlots.every(slot => slot === null));
});

test('stopping during asynchronous quick start cannot restart the emulator', async () => {
    const emulator = makeEmulator();
    emulator.adjustUIForMobile = () => {};
    emulator.ctx = { getImageData: () => ({}) };
    emulator.canvas = { width: 1024, height: 448 };
    let started = false;
    emulator.start = () => { started = true; };
    const pending = emulator.quickStart();
    emulator.stop();
    await pending;
    assert.equal(started, false);
});

test('menu pause releases keyboard input, mutes queued audio and blocks save shortcuts', () => {
    const emulator = makeEmulator();
    emulator.setupKeyboard();
    emulator.audioContext = {};
    emulator.nes.cpu.mem[0x10] = 12;
    emulator.quickSave(1);
    emulator.nes.cpu.mem[0x10] = 99;
    emulator.buttonDown(1, jsnes.Controller.BUTTON_A);
    emulator.pause();
    assert.equal(emulator.isRunning, true);
    assert.equal(emulator.isPaused, true);
    assert.ok(emulator.nes.controllers[1].state.every(value => value === 64));
    emulator.handleAudioSample(1, 1);
    assert.equal(emulator.audioCount, 0);
    document.listeners.keydown({ key: 'j', preventDefault() {} });
    assert.ok(emulator.nes.controllers[1].state.every(value => value === 64));
    document.listeners.keydown({ key: 'F1', preventDefault() {} });
    assert.equal(emulator.nes.cpu.mem[0x10], 99);
    // Explicit menu actions still work while paused.
    assert.equal(emulator.quickLoad(1), true);
    assert.equal(emulator.nes.cpu.mem[0x10], 12);
    emulator.lastFrameTime = -1000;
    emulator.resume();
    assert.equal(emulator.isPaused, false);
    assert.ok(emulator.lastFrameTime >= 0);
    emulator.pause();
    emulator.stop();
    emulator.resume();
    assert.equal(emulator.isRunning, false);
    assert.equal(emulator.isPaused, false);
});

test('recenter restores both scroll axes without changing the game or save slots', () => {
    const scrolling = [];
    const mobileApp = { testMode: true };
    const mobileWindow = {
        scrollY: 120,
        matchMedia: query => ({ matches: query === '(pointer: coarse)' }),
        scrollTo: options => scrolling.push({ target: 'page', ...options })
    };
    const MobileEmulator = new Function('app', 'window', `${source}\nreturn NesEmulator;`)(mobileApp, mobileWindow);
    const emulator = Object.create(MobileEmulator.prototype);
    emulator.quickSaveSlots = [{ progress: 7 }];
    const saved = emulator.quickSaveSlots[0];
    emulator.canvas = {
        offsetWidth: 1024,
        getBoundingClientRect: () => ({ top: 80 }),
        parentElement: { offsetWidth: 400, scrollTo: options => scrolling.push({ target: 'canvas', ...options }) }
    };
    emulator.recenterGameView();
    assert.deepEqual(scrolling, [
        { target: 'page', left: 0, top: 200, behavior: 'smooth' },
        { target: 'canvas', left: 312, behavior: 'smooth' }
    ]);
    assert.equal(emulator.quickSaveSlots[0], saved);
    mobileApp.testMode = false;
    emulator.recenterGameView();
    assert.equal(scrolling.length, 2);
});

test('audio remains stereo FIFO across wraparound and writes silence on underrun', () => {
    const emulator = makeEmulator();
    emulator.audioBufferSize = 4;
    emulator.audioCapacity = 8;
    emulator.audioSamples = new Float32Array(16);
    emulator.clearAudioBuffer();
    const read = length => {
        const left = new Float32Array(length);
        const right = new Float32Array(length);
        emulator.fillAudioOutput(left, right);
        return [Array.from(left), Array.from(right)];
    };
    for (let i = 1; i <= 6; i++) emulator.handleAudioSample(i, -i);
    assert.deepEqual(read(4), [[1, 2, 3, 4], [-1, -2, -3, -4]]);
    for (let i = 7; i <= 10; i++) emulator.handleAudioSample(i, -i);
    assert.deepEqual(read(8), [[5, 6, 7, 8, 9, 10, 0, 0], [-5, -6, -7, -8, -9, -10, 0, 0]]);
    assert.equal(emulator.audioCount, 0);
    for (let i = 1; i <= 9; i++) emulator.handleAudioSample(i, -i);
    assert.deepEqual(read(8), [[5, 6, 7, 8, 9, 0, 0, 0], [-5, -6, -7, -8, -9, 0, 0, 0]]);
    emulator.handleAudioSample(99, -99);
    emulator.pause();
    assert.deepEqual(read(2), [[0, 0], [0, 0]]);
    emulator.resume();
    assert.deepEqual(read(2), [[0, 0], [0, 0]]);
});

test('rendered colors and scaling stay identical when reusing the frame buffer', () => {
    let allocations = 0;
    const uploads = [];
    const draws = [];
    const tempCtx = {
        createImageData(w, h) { allocations++; return { data: new Uint8ClampedArray(w * h * 4) }; },
        putImageData(data) { uploads.push(data); }
    };
    const renderDocument = { createElement: () => ({ getContext: () => tempCtx }) };
    const RenderEmulator = new Function('document', `${source}\nreturn NesEmulator;`)(renderDocument);
    const emulator = Object.create(RenderEmulator.prototype);
    emulator.canvas = { width: 1024, height: 336 };
    emulator.ctx = { fillRect() {}, drawImage(...args) { draws.push(args); } };
    emulator.loadingProgress = 346;
    const frame = new Uint32Array(256 * 240).fill(0x123456);
    emulator.renderFrame(frame);
    assert.deepEqual(Array.from(uploads[0].data.slice(0, 4)), [0x56, 0x34, 0x12, 255]);
    frame[0] = 0xabcdef;
    emulator.renderFrame(frame);
    assert.deepEqual(Array.from(uploads[1].data.slice(0, 4)), [0xef, 0xcd, 0xab, 255]);
    assert.equal(allocations, 1);
    assert.equal(uploads[0], uploads[1]);
    assert.deepEqual(draws[0].slice(1), [0, 0, 256, 240, 332.8, 0, 358.4, 336]);
    assert.equal(emulator.ctx.imageSmoothingEnabled, false);
});
