const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');

const source = ['Config', 'Level', 'RomFix', 'RomEditor', 'DataConverter']
    .map(name => fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8')).join('\n');
const { Romfix, RomEditor, DataConverter } = new Function('i18n',
    `${source}\nreturn { Romfix, RomEditor, DataConverter };`)({ t: key => key });
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const pages = Romfix.COORDINATE_RAM.enemySpawnPages;
const { findRider } = Romfix.addBirdFishPlatform(new Uint8Array(0x20010));

function stage(scene, wide, birthPage) {
    const editor = new RomEditor(); editor.loadROM(original);
    editor.gameConfig.cameraFollow = wide; editor.gameConfig.disableTimer = true;
    const map = Array.from({ length: 14 }, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(5); map[1][2] = 15;
    const converted = DataConverter.fromLevelEditorToROMData({
        background: scene | (wide ? 0x10 : 0), map,
        player: { x: birthPage * 16 + 2, y: 11 }, door: { x: 14, y: 10 },
        enemies: [
            { enemyId: 12, x: birthPage * 16 + 8, y: 6 },
            { enemyId: 1, x: birthPage * 16 + 6, y: 6 }
        ]
    }, wide);
    editor.levels[0].data = converted.mapData;
    editor.levels[0].monsterData = converted.monsterData;
    editor.levelCount = 1;
    return editor.getROMData();
}

function emulator(data) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    return nes;
}

function start(data) {
    const nes = emulator(data);
    for(let i = 0; i < 160; i++) nes.frame();
    nes.buttonDown(1, jsnes.Controller.BUTTON_START); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    for(let i = 0; i < 600; i++) {
        nes.frame();
        const m = nes.cpu.mem;
        if(m[0x30] === 12 && m[0x56] === 3 && !(m[0x2A] & 128)) return nes;
    }
    assert.fail('START did not reach gameplay');
}

function smokeOam(m, slot) {
    const result = [], screenX = m[0x451 + slot], height = m[0x433 + slot] - 1;
    for(let address = 0x200; address < 0x300; address += 4) {
        const x = m[address + 3], relativeX = (x - screenX + 256) & 255;
        if(m[address] === height && [0, 248].includes(relativeX))
            result.push([relativeX, m[address + 1], m[address + 2]]);
    }
    return result.sort((left, right) => left[0] - right[0]);
}

function cannotSupport(nes, data, slot, context) {
    // A stale death velocity can resemble the rider latch. The actual
    // installed support search must reject a carrier while smoke is playing.
    const probe = emulator(data);
    probe.fromJSON(JSON.parse(JSON.stringify(nes.toJSON())));
    const c = probe.cpu, m = c.mem;
    m[0xC1] = m[0x50E + slot]; m[0xC2] = m[0x516 + slot];
    m[0x53E + slot] = 1;
    c.REG_X = 5; c.REG_SP = 0x1FF; c.REG_PC = 0x5FFF; c.irqRequested = false;
    m[0x6000] = 0x20; m[0x6001] = findRider & 255; m[0x6002] = findRider >> 8;
    for(let instruction = 0; instruction < 1000; instruction++) {
        c.emulate();
        if(c.REG_PC === 0x6002) {
            assert.equal(c.REG_SP, 0x1FF, `${context}: support probe balances stack`);
            assert.equal(c.REG_X, 5, `${context}: support probe preserves caller`);
            assert.equal(c.F_CARRY, 0, `${context}: smoke cannot carry the player`);
            return;
        }
    }
    assert.fail(`${context}: support search did not return`);
}

function watchSmoke(nes, data, slot, context, reference = null) {
    const m = nes.cpu.mem, birthX = m[0x516 + slot], birthY = m[0x433 + slot];
    const birthPage = m[0x50E + slot], visibleFrames = new Set(), visibleTiles = new Set();
    assert.equal(m[0x506 + slot], 0, `${context}: starts in native appearance state`);
    const remaining = 90 - (m[0x55E + slot] * 10 + m[0x566 + slot]);
    assert.ok(remaining >= 80 && remaining <= 90, `${context}: appearance starts near its first frame`);
    cannotSupport(nes, data, slot, context);
    for(let frame = 1; frame <= remaining; frame++) {
        nes.frame();
        assert.equal(m[0x56], 3, `${context}: player stays safe`);
        if(frame === remaining) break;
        assert.equal(m[0x506 + slot], 0, `${context}, frame=${frame}: appearance finishes before patrol`);
        assert.equal(m[0x516 + slot], birthX, `${context}: no horizontal patrol during smoke`);
        assert.equal(m[0x50E + slot], birthPage, `${context}: no page changes during smoke`);
        assert.equal(m[0x433 + slot], birthY, `${context}: no vertical platform movement during smoke`);
        assert.ok(m[0x54E + slot] & 128, `${context}: native appearance immunity`);
        assert.equal(m[0x46F + slot] & 0xC0, m[0x556 + slot] >= 4 ? 0x40 : 0,
            `${context}: smoke clears tumble flips and follows native facing`);
        const meta = m[0x415 + slot];
        assert.ok([0, 8, 9].includes(meta), `${context}: only native smoke metasprites (${meta})`);
        if(reference !== null) {
            assert.equal(meta, m[0x415 + reference], `${context}: matches ordinary monster appearance timing`);
            assert.equal(m[0x55E + slot], m[0x55E + reference], `${context}: matches ordinary smoke frame`);
            assert.equal(m[0x566 + slot], m[0x566 + reference], `${context}: matches ordinary smoke clock`);
        }
        if(meta === 8 || meta === 9) {
            visibleFrames.add(meta);
            const sprites = smokeOam(m, slot);
            assert.equal(sprites.length, 2, `${context}: native smoke reaches hardware sprite output`);
            sprites.forEach(sprite => visibleTiles.add(sprite[1]));
            if(reference !== null)
                assert.deepEqual(sprites, smokeOam(m, reference), `${context}: same native smoke artwork and attributes`);
        }
    }
    assert.deepEqual([...visibleFrames].sort(), [8, 9], `${context}: both smoke frames appear`);
    assert.deepEqual([...visibleTiles].sort((a, b) => a - b), [0xA4, 0xE4], `${context}: native smoke artwork`);
    assert.equal(m[0x506 + slot], 1, `${context}: appearance hands off to live patrol at frame 90`);
    // The next ordinary update renders the live helper if appearance's final
    // frame was intentionally left blank.
    nes.frame();
    assert.ok([0x2D, 0x2E].includes(m[0x415 + slot]), `${context}: bird/fish appears after smoke`);
    assert.equal(m[0x546 + slot], birthY, `${context}: platform starts from its birth height`);
    assert.equal(m[0x53E + slot], 0, `${context}: clears former rider or death velocity`);
    assert.equal(m[0x56E + slot], 0, `${context}: no stale descent survives appearance`);
    assert.equal(m[0x57E + slot], 0, `${context}: no stale recovery or respawn timer`);
    assert.equal(nes.cpu.REG_SP, 0x1FF, `${context}: native stack stays balanced`);
}

for(const [scene, wide, birthPage] of [[0, false, 0], [4, true, 1]]) {
    test(`native bird/fish spawn and respawn use ordinary monster smoke: scene=${scene}, wide=${wide}`,
        { skip: !original }, () => {
        const data = stage(scene, wide, birthPage), nes = start(data), m = nes.cpu.mem;
        const slot = m.slice(0x4FE, 0x506).indexOf(12);
        const reference = m.slice(0x4FE, 0x506).indexOf(1);
        const context = `scene=${scene}, wide=${wide}, birth=${birthPage}`;
        assert.ok(slot >= 0 && reference >= 0, context);
        // Native player spawn storage has a four-bit column. Put the camera
        // on the second page before observing a page-one helper's artwork.
        if(birthPage) { m[0xC1] = birthPage; m[0xC2] = 128; }
        watchSmoke(nes, data, slot, `${context}, initial`, reference);

        // The reference monster was needed for appearance only; remove it
        // before the long death countdown so ordinary contact cannot kill
        // the stationary test player as it later walks along the ground.
        m[0x4FE + reference] = m[0x415 + reference] = 0;

        // Use a real thrown-stone collision and the complete native death
        // and respawn delay. The slot must return to smoke before it can fly.
        const spawn = m[0x576 + slot], page = m[pages + slot];
        m[0x8B] = m[0x8E] = 2;
        m[0x8C] = m[0x50E + slot]; m[0x8D] = m[0x516 + slot];
        m[0x43B] = m[0x433 + slot];
        nes.frame();
        assert.equal(m[0x506 + slot], 11, `${context}: real collision starts native defeat`);
        m[0x8B] = m[0x8E] = 0;
        let countdown = false;
        for(let frame = 0; frame < 180; frame++) {
            if(m[0x506 + slot] === 13) { countdown = true; break; }
            nes.frame();
        }
        assert.ok(countdown, `${context}: native death reaches respawn countdown`);
        m[0xC1] = page; m[0xC2] = 64;
        let appeared = false;
        const timers = new Set();
        for(let frame = 0; frame < 850; frame++) {
            nes.frame(); timers.add(m[0x57E + slot]);
            if(m[0x506 + slot] === 0) { appeared = true; break; }
            assert.equal(m[0x506 + slot], 13, `${context}: delay cannot skip directly to live patrol`);
        }
        assert.ok(appeared, `${context}: full delay reaches appearance state`);
        assert.ok(timers.has(100) && timers.has(1), `${context}: complete native respawn countdown`);
        assert.equal(m[0x50E + slot], page, `${context}: restores original birth page`);
        assert.equal(m[0x516 + slot], (spawn & 0xF0) | 6, `${context}: restores birth column`);
        assert.equal(m[0x433 + slot], (spawn & 15) * 16 + 8, `${context}: restores birth height`);
        watchSmoke(nes, data, slot, `${context}, respawn`);
    });
}
