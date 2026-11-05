const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');

const { BirdFish, Coordinates, Enemy, LevelCodec, Project, SpritePatterns } = require('../helpers/source.cjs').load('BirdFish Coordinates Enemy LevelCodec Project SpritePatterns');

const original = process.env.MOAIKUN_TEST_ROM
    ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, body) => test(name, { skip: !original }, body);

test('bird/fish restore native artwork and share PPU slots without replacing the castle boss', () => {
    const data = new Uint8Array(0x20010);
    for (let i = 0; i < 0x3A0; i++) data[0xAA70 + i] = (i % 251) + 1;
    data.fill(0x63, 0xEA70, 0xEE10);
    const bird = data.slice(0xAB90, 0xAC10);
    const fish = data.slice(0xAB10, 0xAB90);
    const native = data.slice(0xAA70, 0xAE10);
    const frames = SpritePatterns.prepareFlightGraphics(data);
    assert.deepEqual(frames, {bird, fish});
    assert.deepEqual(data.slice(0xAAB0, 0xAB30), bird);
    assert.deepEqual(data.slice(0xCAB0, 0xCB30), bird);
    assert.ok(data.slice(0xEA70, 0xEE10).every(byte => byte === 0x63));
});

function stage(scene, wide = false, camera = false, facing = 0, ledgeWallRow = null, obstacle = null) {
    const editor = new Project(); editor.loadROM(original);
    editor.gameConfig.cameraFollow = camera;
    editor.gameConfig.disableTimer = true;
    const width = wide ? 32 : 16;
    const map = Array.from({ length: 14 }, () => Array(width).fill(0));
    map[12].fill(5); map[1][2] = 15;
    if (ledgeWallRow !== null) {
        // At Y=112 the bird's center is in empty row 7, but its upper
        // half still overlaps these row 6 platform edges.
        map[ledgeWallRow].fill(5, 0, 5); map[ledgeWallRow].fill(5, 12, 16);
    } else {
        for (let y = 3; y <= 9; y++) { map[y][4] = 5; map[y][12] = 5; }
    }
    if(obstacle) for(const [x, y] of obstacle) map[y][x] = 5;
    const data = LevelCodec.fromLevelEditorToROMData({
        background: scene | (wide ? 0x10 : 0),
        player: { x: 8, y: 11 }, door: { x: 14, y: 10 }, map,
        enemies: [{ enemyId: 12 | facing, x: 8, y: 6 }]
    }, wide);
    editor.levels[0].data = data.mapData;
    editor.levels[0].monsterData = data.monsterData;
    editor.levelCount = 1;
    return editor.getROMData();
}

function start(data) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    for (let i = 0; i < 160; i++) nes.frame();
    nes.buttonDown(1, jsnes.Controller.BUTTON_START); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    for (let i = 0; i < 600; i++) {
        nes.frame();
        if (nes.cpu.mem[0x30] === 12 && nes.cpu.mem[0x56] === 3 && !(nes.cpu.mem[0x2A] & 128)) {
            const slot = nes.cpu.mem.slice(0x4FE, 0x506).indexOf(12);
            assert.ok(slot >= 0, 'stage contains the bird/fish fixture');
            for(let frame = 0; frame < 100; frame++) {
                if(nes.cpu.mem[0x506 + slot] === 1) return nes;
                nes.frame();
            }
            assert.fail('bird/fish appearance did not reach live patrol');
        }
    }
    assert.fail('START did not reach gameplay');
}

realTest('native graphics selection loads bird or underwater fish into the same sprite slots', () => {
    for (const scene of [0, 4, 5]) {
        const nes = start(stage(scene));
        assert.equal(nes.cpu.mem[0x3E], scene);
        assert.equal(nes.cpu.mem[0x2F], 0x80 + scene);
        assert.deepEqual(Uint8Array.from(nes.ppu.vramMem.slice(0xAA0, 0xB20)),
            Uint8Array.from(SpritePatterns.getFlightSpriteFrames(original, scene === 4)), `scene ${scene}`);
    }
});

realTest('Enemy 12 reverses at both walls, animates, and keeps its height in either map width', () => {
    for (const wide of [false, true]) for (const camera of [false, true]) {
        const nes = start(stage(0, wide, camera, wide ? 0x40 : 0));
        const m = nes.cpu.mem;
        const slot = m.slice(0x4FE, 0x506).indexOf(12);
        assert.ok(slot >= 0);
        const height = m[0x433 + slot];
        const directions = new Set(), frames = new Set();
        let left = 0, right = 0;
        for (let i = 0; i < 600; i++) {
            const x = m[0x516 + slot] + m[0x50E + slot] * 256;
            nes.frame();
            const next = m[0x516 + slot] + m[0x50E + slot] * 256;
            if (next < x) left++; if (next > x) right++;
            assert.ok(next >= 80 && next < 192, `wall penetration: ${next}`);
            assert.equal(m[0x433 + slot], height);
            assert.equal(m[0x4FE + slot], 12);
            directions.add(m[0x556 + slot]); frames.add(m[0x55E + slot]);
        }
        assert.ok(left > 30 && right > 30);
        assert.deepEqual([...directions].sort(), [3, 4]);
        assert.deepEqual([...frames].sort(), [0, 1]);

        // Contact with this scene helper must not enter the enemy damage path.
        m[0xC1] = m[0x50E + slot]; m[0xC2] = m[0x516 + slot];
        m[0x41E] = height; m[0xC7] = 0; m[0xC8] = 0;
        nes.frame();
        assert.equal(m[0x56], 3);
        assert.equal(m[0x4FE + slot], 12);

        m[0x516 + slot] = 0; m[0x50E + slot] = 0;
        m[0x51E + slot] = 0; m[0x556 + slot] = 3;
        nes.frame(); nes.frame();
        assert.equal(m[0x516 + slot] + m[0x50E + slot] * 256, wide ? 511 : 255);
        assert.equal(m[0x556 + slot], 3, 'empty map seams do not count as walls');
    }
});

realTest('bird/fish exports remain byte-stable after reloading and preserve native boss graphics', () => {
    const data = stage(4);
    assert.deepEqual(data.slice(0xEA70, 0xEE10), Uint8Array.from(original.slice(0xEA70, 0xEE10)));
});

realTest('half-tile bird/fish height still collides with the upper platform edges in either direction', () => {
    for (const scene of [0, 4]) for (const wide of [false, true]) for (const facing of [0, 0x40]) {
        const data = stage(scene, wide, true, facing, 6);
        assert.deepEqual(data.slice(0x1340, 0x142A), Uint8Array.from(original.slice(0x1340, 0x142A)),
            'the shared native collision probe and its coordinate tables remain unchanged');
        const nes = start(data), m = nes.cpu.mem;
        const slot = m.slice(0x4FE, 0x506).indexOf(12);
        const context = `scene=${scene}, wide=${wide}, facing=${facing}`;
        assert.ok(slot >= 0, context);
        // Hold the half-tile checkpoint in place while native map probing,
        // horizontal movement, reversal and rendering continue each frame.
        m[0x433 + slot] = m[0x546 + slot] = 112;
        m[0x56E + slot] = m[0x57E + slot] = m[0x53E + slot] = 0;
        m[0x516 + slot] = 128; m[0x50E + slot] = m[0x51E + slot] = 0;
        m[0x556 + slot] = facing ? 3 : 4;
        let left = 0, right = 0;
        for (let i = 0; i < 500; i++) {
            const before = m[0x516 + slot] + m[0x50E + slot] * 256;
            nes.frame();
            const after = m[0x516 + slot] + m[0x50E + slot] * 256;
            if (after < before) left++; if (after > before) right++;
            assert.ok(after >= 80 && after < 192, `${context}: upper edge penetration at X=${after}`);
            assert.equal(m[0x433 + slot], 112, context);
            assert.equal(m[0x4FE + slot], 12, context);
        }
        assert.ok(left > 30 && right > 30, `${context}: traverses and reverses both ways`);
    }
});

realTest('bird/fish private wall probes cover partial rows without blocking adjacent aligned rows', () => {
    const { walls } = BirdFish.addBirdFishPlatform(new Uint8Array(0x20010));
    for (const row of [5, 6, 7]) {
        const nes = start(stage(0, false, false, 0, row)), c = nes.cpu, m = c.mem;
        for (const x of [85, 186]) for (let y = 104; y <= 120; y++) {
            m[0x00] = x; m[0x01] = 0; m[0x02] = y;
            c.REG_X = 6; c.REG_SP = 0x1FF; c.REG_PC = 0x5FFF; c.irqRequested = false;
            // Invoke the installed helper against the real native tile map.
            m[0x6000] = 0x20; m[0x6001] = walls & 255; m[0x6002] = walls >> 8;
            let returned = false;
            for (let i = 0; i < 1000; i++) {
                c.emulate();
                if (c.REG_PC === 0x6002) { returned = true; break; }
            }
            assert.ok(returned, 'private wall probe returns');
            assert.equal(c.REG_SP, 0x1FF, 'private wall probe balances the native stack');
            assert.equal(c.REG_X, 6, 'private wall probe preserves the caller enemy slot');
            const expected = y === 104 ? row === 6 : y === 120 ? row === 7 : row === 6 || row === 7;
            const context = `solid row=${row}, X=${x}, Y=${y}`;
            assert.equal(Boolean(m[x === 85 ? 0xAD : 0xAE]), expected, context);
            assert.equal(m[x === 85 ? 0xAE : 0xAD], 0, `${context}: opposite side stays clear`);
        }
    }
});

realTest('native bird/fish landings sink half a tile, recover, or commit repeated jumps while riding normally', () => {
    for (const scene of [0, 4]) for (const wide of [false, true]) for (const camera of [false, true]) {
        const nes = start(stage(scene, wide, camera)), m = nes.cpu.mem;
        const slot = m.slice(0x4FE, 0x506).indexOf(12);
        const height = m[0x433 + slot];
        const signedY = () => (m[0x7D] >= 128 ? m[0x7D] - 256 : m[0x7D]) * 256 + m[0x41E];
        const step = count => { for (let i = 0; i < count; i++) nes.frame(); };
        const descend = () => {
            // A checkpoint just above the moving surface; the native player
            // integrator, platform collision and remaining frames run normally.
            m[0xC1] = m[0x50E + slot]; m[0xC2] = m[0x516 + slot];
            m[0x41E] = m[0x433 + slot] - 18; m[0x7D] = 0;
            m[0xC0] = 2; m[0x52] = 16; m[0xC7] = 1; m[0xC8] = 0;
            for (let i = 0; i < 10 && !m[0x53E + slot]; i++) nes.frame();
            assert.equal(m[0x53E + slot], 1, `scene=${scene}, wide=${wide}: descending landing`);
        };
        const jumpAndLand = () => {
            // Use actual A input. No player-position edits occur during the jump.
            nes.buttonDown(1, jsnes.Controller.BUTTON_A); step(1);
            assert.equal(m[0xC0], 2);
            assert.equal(m[0x53E + slot], 0);
            assert.ok(m[0xC7] & 128, 'native upward jump stays airborne');
            nes.buttonUp(1, jsnes.Controller.BUTTON_A);
            for (let i = 0; i < 60 && !m[0x53E + slot]; i++) {
                // Follow the autonomous bird with ordinary airborne steering,
                // just as a player must when repeatedly jumping on its head.
                const delta = m[0xC1] * 256 + m[0xC2] - m[0x50E + slot] * 256 - m[0x516 + slot];
                nes.buttonUp(1, jsnes.Controller.BUTTON_LEFT);
                nes.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
                if(delta > 2) nes.buttonDown(1, jsnes.Controller.BUTTON_LEFT);
                if(delta < -2) nes.buttonDown(1, jsnes.Controller.BUTTON_RIGHT);
                nes.frame();
            }
            nes.buttonUp(1, jsnes.Controller.BUTTON_LEFT);
            nes.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
            assert.equal(m[0x53E + slot], 1, 'the native jump lands on the moving bird again');
            step(10);
        };
        descend(); step(12);
        assert.equal(m[0x433 + slot], height + 8, 'landing sinks exactly half a tile');
        assert.equal(m[0x546 + slot], height, 'the initial whole-tile height remains the recovery destination');
        assert.equal(m[0x56E + slot], 8);
        assert.ok(m[0x57E + slot] > 0 && m[0x57E + slot] <= 90, 'the settled half-step starts its recovery timer');
        assert.equal(signedY(), height - 8);
        assert.equal(m[0xC0], 1);

        for(const button of [jsnes.Controller.BUTTON_DOWN, jsnes.Controller.BUTTON_UP]) {
            nes.buttonDown(1, button); step(10);
            nes.buttonUp(1, button); step(1);
            assert.equal(m[0x546 + slot], height, 'vertical input cannot command a new destination');
            assert.equal(m[0x433 + slot], height + 8, 'vertical input does not alter the pending half-step');
            assert.equal(m[0x53E + slot], 1);
        }

        nes.buttonDown(1, jsnes.Controller.BUTTON_START); step(2);
        nes.buttonUp(1, jsnes.Controller.BUTTON_START); step(5);
        const paused = [m[0x433 + slot], m[0x546 + slot], m[0x57E + slot], signedY()];
        step(30);
        assert.deepEqual([m[0x433 + slot], m[0x546 + slot], m[0x57E + slot], signedY()], paused,
            'pause freezes the half-step and its recovery countdown');
        nes.buttonDown(1, jsnes.Controller.BUTTON_START); step(2);
        nes.buttonUp(1, jsnes.Controller.BUTTON_START); step(120);
        assert.equal(m[0x433 + slot], height, 'standing still allows the half-step to recover');
        assert.equal(signedY(), height - 16);
        assert.equal(m[0x56E + slot], 0);
        assert.equal(m[0x56], 3);
        assert.equal(m[0x53E + slot], 1);

        jumpAndLand();
        assert.equal(m[0x433 + slot], height + 8, 'the next jump starts a new half-step');
        assert.equal(m[0x546 + slot], height);
        jumpAndLand();
        assert.equal(m[0x433 + slot], height + 16, 'a second landing before recovery completes one whole tile');
        assert.equal(m[0x546 + slot], height + 16);
        assert.equal(m[0x56E + slot], 0);
        step(120);
        assert.equal(m[0x433 + slot], height + 16, 'the committed whole-tile drop does not recover');
        jumpAndLand();
        assert.equal(m[0x433 + slot], height + 24, 'later jumps can begin another half-step');
        jumpAndLand();
        assert.equal(m[0x433 + slot], height + 32, 'each further pair of landings can lower another tile');
        assert.equal(m[0x546 + slot], height + 32);
        step(120);
        assert.equal(m[0x433 + slot], height + 32, 'remaining aboard never triggers another drop');
        assert.equal(m[0x57E + slot], 0);
        assert.equal(m[0x56], 3);

        const attributes = [];
        for (let offset = 0; offset < 256; offset += 4) {
            if ([0xAA, 0xAC, 0xAE, 0xB0].includes(m[0x201 + offset]))
                attributes.push(m[0x202 + offset] & 3);
        }
        assert.ok(attributes.length > 0, 'bird/fish hardware sprites are drawn');
        assert.ok(attributes.every(value => value === 0), 'runtime uses protagonist palette 0');

        // Rider LR belongs to native walking, independent of bird direction.
        for(const [button, facing, patrol] of [[jsnes.Controller.BUTTON_LEFT, 3, 4],
            [jsnes.Controller.BUTTON_RIGHT, 4, 3]]) {
            m[0x516 + slot] = 128; m[0x50E + slot] = m[0x51E + slot] = 0;
            m[0x556 + slot] = patrol; descend();
            nes.buttonDown(1, button); step(6);
            assert.equal(m[0xCB], facing, 'native facing follows walking input');
            assert.equal(m[0x556 + slot], patrol, 'walking cannot steer the bird');
            const separation = m[0xC1] * 256 + m[0xC2] - m[0x50E + slot] * 256 - m[0x516 + slot];
            assert.ok(facing === 3 ? separation < 0 : separation > 0, 'the rider walks across the surface');
            step(30);
            assert.equal(m[0x53E + slot], 0, 'ordinary walking can leave the carrier');
            nes.buttonUp(1, button); step(1);
        }
    }
});

realTest('native bird/fish rider OAM stays aligned without changing blink timing or native controls', () => {
    for (const scene of [0, 4]) for (const wide of [false, true]) for (const camera of [false, true]) {
        const nes = start(stage(scene, wide, camera)), m = nes.cpu.mem;
        const slot = m.slice(0x4FE, 0x506).indexOf(12);
        const context = `scene=${scene}, wide=${wide}, camera=${camera}`;
        const step = count => { for (let i = 0; i < count; i++) nes.frame(); };
        const worldSeparation = () => m[0xC1] * 256 + m[0xC2]
            - m[0x50E + slot] * 256 - m[0x516 + slot];
        const sprites = tiles => {
            const result = [];
            for (let offset = 0; offset < 256; offset += 4) {
                if (m[0x200 + offset] < 240 && tiles.includes(m[0x201 + offset]))
                    result.push(m.slice(0x200 + offset, 0x204 + offset));
            }
            return result;
        };
        // Begin above the carrier, then let native falling and landing run.
        // The original spawn blink must finish before testing visible OAM.
        m[0xD3] = 0;
        m[0xC1] = m[0x50E + slot]; m[0xC2] = m[0x516 + slot];
        m[0x41E] = m[0x433 + slot] - 18; m[0x7D] = 0;
        m[0xC0] = 2; m[0x52] = 16; m[0xC7] = 1; m[0xC8] = 0;
        for (let i = 0; i < 10 && !m[0x53E + slot]; i++) nes.frame();
        assert.equal(m[0x53E + slot], 1, `${context}: native landing`);
        step(12);
        const halfHeight = m[0x433 + slot];
        assert.equal(m[0x56E + slot], 8, `${context}: settled half-step`);
        const checkStandingOam = phase => {
            const expectedX = worldSeparation(), xOffsets = new Set();
            for (let frame = 0; frame < 32; frame++) {
                nes.frame();
                const player = sprites([0x04, 0x06]);
                const carrier = sprites([0xAA, 0xAC, 0xAE, 0xB0]);
                assert.equal(player.length, 2, `${context}, ${phase}: both player halves are visible`);
                assert.equal(carrier.length, 2, `${context}, ${phase}: both carrier halves are visible`);
                const dx = Math.min(...player.map(sprite => sprite[3]))
                    - Math.min(...carrier.map(sprite => sprite[3]));
                xOffsets.add(dx);
                assert.equal(dx, expectedX, `${context}, ${phase}, frame=${frame}: OAM uses the carried X this frame`);
                assert.ok(player.every(sprite => sprite[0] === carrier[0][0] - 16),
                    `${context}, ${phase}: OAM height stays exactly above the carrier`);
                assert.equal(m[0xC0], 1, `${context}, ${phase}: native standing state`);
                assert.equal(m[0xC7], 0, `${context}, ${phase}: no vertical velocity`);
                assert.equal(m[0x53E + slot], 1, `${context}, ${phase}: rider remains latched`);
            }
            assert.equal(xOffsets.size, 1, `${context}, ${phase}: no alternating one-pixel offset`);
        };
        checkStandingOam('half-step');
        assert.equal(m[0x433 + slot], halfHeight, `${context}: half-step remains stationary`);
        step(120);
        assert.equal(m[0x433 + slot], halfHeight - 8, `${context}: whole-tile height recovers`);
        assert.equal(m[0x56E + slot], 0);
        checkStandingOam('recovered');

        m[0xD3] = 12;
        for (let remaining = 11; remaining >= 0; remaining--) {
            nes.frame();
            assert.equal(m[0xD3], remaining, `${context}: native blink timer ticks once per frame`);
        }
        nes.buttonDown(1, jsnes.Controller.BUTTON_A); step(1);
        assert.equal(m[0xC0], 2, `${context}: native A starts a jump`);
        assert.equal(m[0x53E + slot], 0, `${context}: jumping releases the carrier`);
        assert.ok(m[0xC7] & 128, `${context}: native jump velocity points upward`);
        nes.buttonUp(1, jsnes.Controller.BUTTON_A);
        for (let frame = 0; frame < 60 && !m[0x53E + slot]; frame++) {
            const delta = worldSeparation();
            nes.buttonUp(1, jsnes.Controller.BUTTON_LEFT);
            nes.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
            if (delta > 2) nes.buttonDown(1, jsnes.Controller.BUTTON_LEFT);
            if (delta < -2) nes.buttonDown(1, jsnes.Controller.BUTTON_RIGHT);
            nes.frame();
        }
        nes.buttonUp(1, jsnes.Controller.BUTTON_LEFT);
        nes.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
        assert.equal(m[0x53E + slot], 1, `${context}: native steering can land again`);
        step(10);
        const beforeWalk = worldSeparation();
        nes.buttonDown(1, jsnes.Controller.BUTTON_LEFT); step(6);
        assert.equal(m[0xCB], 3, `${context}: native facing follows left input`);
        assert.ok(worldSeparation() < beforeWalk, `${context}: native walking moves across the carrier`);
        nes.buttonUp(1, jsnes.Controller.BUTTON_LEFT);
    }
});

realTest('native bird vertical probes cancel blocked descents while waiting for blocked ascents', () => {
    const { update } = BirdFish.addBirdFishPlatform(new Uint8Array(0x20010));
    for(const [scene, wide] of [[0, false], [4, true]]) {
        const nes = start(stage(scene, wide, true, 0, null, [[7, 8], [9, 6], [9, 5]]));
        const c = nes.cpu, m = c.mem, slot = m.slice(0x4FE, 0x506).indexOf(12);
        const map = m.slice(0x700, 0x800);
        const run = count => {
            for(let frame = 0; frame < count; frame++) {
                c.REG_X = slot; c.REG_Y = 17; c.REG_SP = 0x1FF; c.REG_PC = 0x5FFF; c.irqRequested = false;
                m[0x6000] = 0x20; m[0x6001] = update & 255; m[0x6002] = update >> 8;
                let returned = false;
                for(let i = 0; i < 10000; i++) {
                    c.emulate();
                    if(c.REG_PC === 0x6002) { returned = true; break; }
                }
                assert.ok(returned, 'installed vertical helper returns through real native terrain probes');
                assert.equal(c.REG_SP, 0x1FF); assert.equal(c.REG_X, slot); assert.equal(c.REG_Y, 17);
            }
        };
        const position = (x, y, target, rider = false, offset = 0) => {
            for(let i = 0; i < map.length; i++) m[0x700 + i] = map[i];
            m[0x516 + slot] = m[0x526 + slot] = x; m[0x50E + slot] = 0;
            m[0x433 + slot] = y; m[0x546 + slot] = target; m[0x53E + slot] = Number(rider);
            m[0x56E + slot] = m[0x57E + slot] = 0;
            m[0x56] = 3; m[0xC0] = rider ? 1 : 2; m[0xC7] = rider ? 0 : 0xFC;
            m[0xC8] = m[0x7D] = m[0xF4] = 0;
            m[0xC1] = 0; m[0xC2] = x + offset; m[0x41E] = y - 16;
        };
        for(const rider of [false, true]) {
            position(132, 112, 128, rider); run(24);
            assert.equal(m[0x433 + slot], 120, 'downward left body edge stops flush above row 8');
            assert.equal(m[0x546 + slot], 120, 'a blocked descent commits only the height it actually reached');
            assert.equal(m[0x56E + slot], 0, 'blocked descent leaves no pending half-step');
            assert.equal(m[0x57E + slot], 0, 'blocked descent leaves no pending recovery timer');
            if(rider) assert.equal(m[0x41E], 104, 'blocked descent keeps its rider above the floor');
            m[0x783] &= 0xF0; run(8);
            assert.equal(m[0x433 + slot], 120, 'removing the blocking tile cannot release a stored descent');

            position(140, 128, 112, rider, rider ? -10 : 0); run(24);
            assert.equal(m[0x433 + slot], 120, 'upward right body edge stops flush below row 6');
            assert.equal(m[0x546 + slot], 112, 'blocked recovery retains its upward destination');
            m[0x764] &= 0xF0; m[0x754] &= 0xF0; run(8);
            assert.equal(m[0x433 + slot], 112, 'removing the blocking tiles allows the pending ascent');
        }
        for(const [from, to] of [[112, 128], [128, 112]]) {
            position(136, from, to); run(24);
            assert.equal(m[0x433 + slot], to, 'adjacent solids never obstruct a clear body column');
        }
        position(120, 112, 128); run(24);
        assert.equal(m[0x433 + slot], 120, 'the centered lower sample blocks a column-aligned bird');
        position(152, 128, 112); run(24);
        assert.equal(m[0x433 + slot], 120, 'the centered upper sample blocks a column-aligned bird');
        position(132, 128, 112, true, 10); m[0x764] &= 0xF0; run(24);
        assert.equal(m[0x433 + slot], 120, 'an offset rider ceiling blocks ascent even with a clear bird column');
        assert.equal(m[0x41E], 104, 'the rider head remains flush below the ceiling');
        assert.equal(m[0x53E + slot], 1);
        m[0x754] &= 0xF0; m[0x764] &= 0xF0; run(8);
        assert.equal(m[0x433 + slot], 112, 'the rider and bird continue only once the ceiling clears');
    }
});

realTest('native bird/fish cancel repeated landings above land before patrolling beyond its cliff', () => {
    for(const [scene, wide] of [[0, false], [4, true]]) {
        const floor = [6, 7, 8, 9].map(x => [x, 7]);
        const nes = start(stage(scene, wide, true, 0, null, floor)), m = nes.cpu.mem;
        const slot = m.slice(0x4FE, 0x506).indexOf(12);
        const height = m[0x433 + slot], context = `scene=${scene}, wide=${wide}`;
        assert.equal(height, 104, `${context}: the bird starts flush above the added land`);
        m[0x516 + slot] = m[0x526 + slot] = 128;
        m[0x50E + slot] = m[0x51E + slot] = 0;
        m[0x556 + slot] = 4;

        for(let landing = 0; landing < 6; landing++) {
            // Re-enter a descending contact while normal native player,
            // terrain, horizontal patrol and platform updates still run.
            m[0x53E + slot] = 0;
            m[0xC1] = m[0x50E + slot]; m[0xC2] = m[0x516 + slot];
            m[0x41E] = height - 18; m[0x7D] = 0;
            m[0xC0] = 2; m[0x52] = 16; m[0xC7] = 1; m[0xC8] = 0;
            for(let frame = 0; frame < 10 && !m[0x53E + slot]; frame++) nes.frame();
            assert.equal(m[0x53E + slot], 1, `${context}: landing ${landing + 1} reaches the bird`);
            assert.equal(m[0x433 + slot], height, `${context}: real row 7 terrain blocks landing ${landing + 1}`);
            assert.equal(m[0x546 + slot], height, `${context}: landing ${landing + 1} stores no lower destination`);
            assert.equal(m[0x56E + slot], 0, `${context}: landing ${landing + 1} stores no half-step`);
            assert.equal(m[0x57E + slot], 0, `${context}: landing ${landing + 1} stores no recovery countdown`);
        }

        let beyondCliffFrames = 0;
        for(let frame = 0; frame < 100; frame++) {
            nes.frame();
            const x = m[0x50E + slot] * 256 + m[0x516 + slot];
            if(x >= 168) beyondCliffFrames++;
            assert.equal(m[0x433 + slot], height, `${context}: leaving the cliff never releases old downward steps`);
            assert.equal(m[0x546 + slot], height, `${context}: patrol keeps the actual supported height`);
            assert.equal(m[0x56E + slot], 0);
            assert.equal(m[0x57E + slot], 0);
            assert.equal(m[0x506 + slot], 1, `${context}: normal flight continues`);
            assert.equal(m[0x56], 3, `${context}: native gameplay continues`);
        }
        assert.ok(beyondCliffFrames >= 20, `${context}: patrol spends ${beyondCliffFrames} frames clear of the cliff`);
    }
});

realTest('ridden bird/fish retain autonomous wall reversal at half-grid heights', () => {
    for(const [scene, wide] of [[0, false], [4, true]]) {
        const nes = start(stage(scene, wide, true)), m = nes.cpu.mem;
        const slot = m.slice(0x4FE, 0x506).indexOf(12), directions = new Set();
        m[0x433 + slot] = m[0x546 + slot] = 112;
        m[0x516 + slot] = m[0x526 + slot] = m[0xC2] = 128;
        m[0x50E + slot] = m[0xC1] = m[0x7D] = m[0xC7] = m[0xC8] = 0;
        m[0x53E + slot] = m[0xC0] = 1; m[0x41E] = 96; m[0x556 + slot] = 4;
        for(let frame = 0; frame < 500; frame++) {
            nes.frame(); directions.add(m[0x556 + slot]);
            const x = m[0x50E + slot] * 256 + m[0x516 + slot];
            assert.ok(x >= 80 && x < 192, `ridden wall penetration at X=${x}`);
            assert.equal(m[0x433 + slot], 112); assert.equal(m[0x53E + slot], 1);
            assert.ok(Math.abs(m[0xC1] * 256 + m[0xC2] - x) <= 2,
                'the rider follows the patrol while native wall contact can hold it one pixel clear');
        }
        assert.deepEqual([...directions].sort(), [3, 4]);
    }
});

realTest('real headbutts give harmless bird/fish the native death tumble and complete respawn countdown', () => {
    const { defeat, findRider } = BirdFish.addBirdFishPlatform(new Uint8Array(0x20010));
    const pages = Coordinates.COORDINATE_RAM.enemySpawnPages;
    for(const scene of [0, 4]) for(const wide of [false, true]) for(const camera of [false, true]) {
        const data = stage(scene, wide, camera), nes = start(data), c = nes.cpu, m = c.mem;
        const slot = m.slice(0x4FE, 0x506).indexOf(12);
        const context = `scene=${scene}, wide=${wide}, camera=${camera}`;
        assert.ok(slot >= 0, context);
        for(let i = 0; i < 160; i++) nes.frame();
        const spawn = m[0x576 + slot], birthPage = m[pages + slot];
        const attackY = m[0x41E];

        // Put the live bird beside the grounded player while retaining its
        // original birthplace. Only actual B input may start its death state.
        m[0xC1] = 0; m[0xC2] = 64; m[0xCB] = 4;
        m[0xC0] = 1; m[0x7D] = m[0xC4] = m[0xC7] = m[0xC8] = 0;
        m[0x50E + slot] = 0; m[0x516 + slot] = m[0x526 + slot] = 78;
        m[0x433 + slot] = m[0x546 + slot] = attackY;
        m[0x556 + slot] = 4; m[0x53E + slot] = m[0x56E + slot] = 0;
        assert.equal(m[0x506 + slot], 1, `${context}: live patrol before B`);

        // Observe the dispatch reached by the native attack; do not invoke
        // the death helper or write an enemy state from the test.
        const emulate = c.emulate.bind(c);
        const flips = new Set(), hardwareFlips = new Set(), heights = [], states = new Set();
        let hitState = null;
        c.emulate = () => {
            if(c.REG_PC === defeat - 1 && c.REG_X === slot) states.add(m[0x506 + slot]);
            if(c.REG_PC === defeat - 1 && c.REG_X === slot && hitState === null) {
                hitState = m[0x506 + slot];
                assert.equal(hitState, 11, `${context}: native B starts the shared death tumble`);
                assert.ok(m[0x54E + slot] & 128, `${context}: the native hit marks the bird defeated`);
            }
            return emulate();
        };
        let visibleTumbleFrames = 0, supportChecked = false, countdown = false;
        try {
            nes.buttonDown(1, jsnes.Controller.BUTTON_B); nes.frame();
            nes.buttonUp(1, jsnes.Controller.BUTTON_B);
            for(let i = 0; i < 160; i++) {
                assert.equal(m[0x30], 12, context);
                assert.equal(m[0x56], 3, `${context}: headbutting stays harmless`);
                const state = m[0x506 + slot];
                states.add(state);
                if(state === 11) {
                    heights.push(m[0x433 + slot]);
                    flips.add(m[0x46F + slot] & 0xC0);
                    let drawn = false;
                    for(let offset = 0; offset < 256; offset += 4) {
                        if(m[0x200 + offset] < 240 && m[0x201 + offset] >= 0xAA && m[0x201 + offset] <= 0xB1) {
                            drawn = true; hardwareFlips.add(m[0x202 + offset] & 0xC0);
                        }
                    }
                    if(drawn) visibleTumbleFrames++;
                    if(!supportChecked && m[0x53E + slot] !== 0) {
                        // The native tumble reuses the former rider byte for
                        // Y velocity. Probe the installed support search in an
                        // isolated CPU snapshot without changing this flight.
                        const probe = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
                        probe.loadROM(Buffer.from(data).toString('binary'));
                        probe.fromJSON(JSON.parse(JSON.stringify(nes.toJSON())));
                        const pc = probe.cpu, pm = pc.mem;
                        pm[0xC1] = pm[0x50E + slot]; pm[0xC2] = pm[0x516 + slot];
                        pc.REG_X = 5; pc.REG_SP = 0x1FF; pc.REG_PC = 0x5FFF; pc.irqRequested = false;
                        pm[0x6000] = 0x20; pm[0x6001] = findRider & 255; pm[0x6002] = findRider >> 8;
                        let returned = false;
                        for(let instruction = 0; instruction < 1000; instruction++) {
                            pc.emulate();
                            if(pc.REG_PC === 0x6002) { returned = true; break; }
                        }
                        assert.ok(returned, `${context}: support search returns`);
                        assert.equal(pc.REG_SP, 0x1FF, `${context}: support search balances the stack`);
                        assert.equal(pc.REG_X, 5, `${context}: support search preserves the caller slot`);
                        assert.equal(pc.F_CARRY, 0, `${context}: defeated birds cannot support a rider`);
                        supportChecked = true;
                    }
                }
                if(state === 13) { countdown = true; break; }
                nes.frame();
            }
        } finally {
            c.emulate = emulate;
            nes.buttonUp(1, jsnes.Controller.BUTTON_B);
        }
        assert.notEqual(hitState, null, `${context}: the real B attack hits type 12`);
        assert.ok(countdown, `${context}: the tumble finishes before respawn countdown`);
        assert.ok(states.has(11) && states.has(10) && states.has(13),
            `${context}: native tumble, disappearance and delay states all run (${[...states]})`);
        assert.ok(visibleTumbleFrames >= 12, `${context}: death stays visibly animated for ${visibleTumbleFrames} frames`);
        assert.deepEqual([...flips].sort((a, b) => a - b), [0, 0x40, 0x80, 0xC0],
            `${context}: native sprite attributes complete a full tumble`);
        assert.deepEqual([...hardwareFlips].sort((a, b) => a - b), [0, 0x40, 0x80, 0xC0],
            `${context}: hardware sprites display a full native tumble`);
        const highest = Math.min(...heights), apex = heights.indexOf(highest);
        assert.ok(highest < attackY && apex > 0 && apex < heights.length - 1,
            `${context}: the defeated bird rises before falling`);
        assert.ok(heights.slice(apex + 1).some(y => y > highest + 16), `${context}: gravity brings the defeated bird down`);
        assert.ok(supportChecked, `${context}: the native Y velocity never becomes platform support`);
        assert.equal(m[0x4FE + slot], 12, `${context}: the sprite remains eligible to respawn`);
        assert.ok(m[0x57E + slot] >= 199, `${context}: the native 200-tick delay is retained`);

        m[0xC1] = birthPage; m[0xC2] = 80;
        const timers = new Set();
        let visibleAt = -1;
        for(let i = 0; i < 950; i++) {
            nes.frame();
            assert.equal(m[0x30], 12, context);
            assert.equal(m[0x56], 3, `${context}: player stays safe throughout respawn`);
            assert.equal(m[0x4FE + slot], 12, context);
            assert.equal(m[pages + slot], birthPage, context);
            assert.equal(m[0x576 + slot], spawn, `${context}: original birthplace is retained`);
            timers.add(m[0x57E + slot]);
            if(m[0x506 + slot] === 1) {
                assert.equal(m[0x57E + slot], 0, `${context}: patrol waits for the full delay`);
                if(!(m[0x54E + slot] & 128) && m[0x415 + slot]) { visibleAt = i; break; }
            }
        }
        assert.ok(timers.has(100) && timers.has(1), `${context}: full countdown uses real enemy updates`);
        assert.ok(visibleAt >= 790 && visibleAt < 950, `${context}: visibleAt=${visibleAt}`);
        assert.equal(m[0x50E + slot], birthPage, context);
        assert.equal(m[0x433 + slot], (spawn & 15) * 16 + 8, `${context}: restores the birth height`);
        assert.equal(m[0x546 + slot], m[0x433 + slot], `${context}: respawn resets the flight target`);
        assert.equal(m[0x506 + slot], 1, `${context}: respawn resumes ordinary patrol`);
        assert.equal(c.REG_SP, 0x1FF, context);
    }
});
