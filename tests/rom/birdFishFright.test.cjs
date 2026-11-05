const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');

const { LevelCodec, Project } = require('../helpers/source.cjs').load('LevelCodec Project');

const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, body) => test(name, { skip: !original }, body);

function stage(scene = 0, wide = false, extraTiles = [], punchColumn = 3) {
    const editor = new Project(); editor.loadROM(original);
    editor.gameConfig.cameraFollow = true; editor.gameConfig.disableTimer = true;
    const map = Array.from({ length: 14 }, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(5); map[1][2] = 15; map[11][punchColumn] = 13;
    for(const [x, y, tile] of extraTiles) map[y][x] = tile;
    const converted = LevelCodec.fromLevelEditorToROMData({
        background: scene | (wide ? 0x10 : 0), map,
        player: { x: 2, y: 11 }, door: { x: 14, y: 10 },
        enemies: [{ enemyId: 12, x: 8, y: 6 }, { enemyId: 12, x: 10, y: 8 }]
    }, wide);
    editor.levels[0].data = converted.mapData;
    editor.levels[0].monsterData = converted.monsterData;
    editor.levelCount = 1;
    return editor.getROMData();
}

function machine(data, snapshot) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    if(snapshot) nes.fromJSON(JSON.parse(JSON.stringify(snapshot)));
    return nes;
}

function start(data) {
    const nes = machine(data);
    for(let i = 0; i < 160; i++) nes.frame();
    nes.buttonDown(1, jsnes.Controller.BUTTON_START); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    for(let i = 0; i < 600; i++) {
        nes.frame(); const m = nes.cpu.mem;
        if(m[0x30] === 12 && m[0x56] === 3 && !(m[0x2A] & 128)) {
            for(let j = 0; j < 160; j++) nes.frame();
            return nes;
        }
    }
    assert.fail('START did not reach active gameplay');
}

const birdSlot = m => m.slice(0x4FE, 0x506).indexOf(12);
function placeBird(m, slot, x, y = 120, facing = 4) {
    m[0x50E + slot] = x >> 8;
    m[0x516 + slot] = m[0x526 + slot] = x & 255;
    m[0x51E + slot] = 0;
    m[0x433 + slot] = m[0x546 + slot] = y;
    m[0x556 + slot] = facing;
    m[0x53E + slot] = m[0x56E + slot] = m[0x57E + slot] = 0;
}

function punch(nes, worldX = 40, y = 184) {
    const m = nes.cpu.mem;
    m[0xC1] = worldX >> 8; m[0xC2] = worldX & 255;
    m[0x41E] = y; m[0x7D] = 0; m[0xCB] = 4; m[0xC0] = 1;
    m[0xC4] = m[0xC7] = m[0xC8] = 0;
    nes.buttonDown(1, jsnes.Controller.BUTTON_B); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_B);
}

const position = (m, slot) => m[0x51E + slot] + 256 * (m[0x516 + slot] + 256 * m[0x50E + slot]);
function moveFrame(nes, slot, left = false) {
    const m = nes.cpu.mem, size = (m[0x3D] ? 512 : 256) * 256;
    const before = position(m, slot), animationTick = m[0x566 + slot];
    // The native PPU queue can consume a video frame without a simulation
    // update. Count the same live enemy ticks that advance the rising bird.
    let advanced = false;
    for(let i = 0; i < 8; i++) {
        nes.frame();
        if(m[0x566 + slot] !== animationTick) { advanced = true; break; }
    }
    assert.ok(advanced, 'a live unpaused bird receives its next simulation tick');
    const after = position(m, slot);
    return ((left ? before - after : after - before) + size) % size / 256;
}

for(const [scene, wide] of [[0, false], [4, true]]) {
    realTest(`real Tile 13 fright assigns a proximity speed for the rise: scene=${scene}, wide=${wide}`, () => {
        const data = stage(scene, wide), initial = start(data).toJSON();
        for(const [distance, speed] of [[16, 2], [48, 1.5], [80, 1], [112, 0.5]]) {
            const nes = machine(data, initial), m = nes.cpu.mem, slot = birdSlot(m);
            placeBird(m, slot, 40 + distance);
            punch(nes);
            assert.equal(m[0x546 + slot], 104, 'a real B impact reaches the global bird event');
            assert.equal(m[0x556 + slot], 4, 'a bird right of the player escapes right');
            assert.equal(m[0x5C6 + slot], 1, 'impact starts a height-bound fright reaction');
            for(let frame = 0; frame < 15; frame++) {
                assert.equal(moveFrame(nes, slot), speed,
                    `distance=${distance}, frame=${frame}: impact distance fixes the flight speed`);
            }
            assert.equal(m[0x433 + slot], 104, 'the rise finishes after 16 active updates');
            assert.equal(m[0x5C6 + slot], 0, 'the reaction ends at the new height');
            assert.equal(moveFrame(nes, slot), 0.5, 'ordinary patrol resumes immediately after the rise');
        }
    });
}

realTest('real fright ends on the target-height tick and another impact extends the current rise', () => {
    const nes = start(stage()), m = nes.cpu.mem, slot = birdSlot(m);
    placeBird(m, slot, 56);
    const before = position(m, slot);
    punch(nes);
    const speeds = [(position(m, slot) - before + 65536) % 65536 / 256];
    for(let i = 0; i < 15; i++) speeds.push(moveFrame(nes, slot));
    assert.deepEqual(speeds, Array(16).fill(2), 'all 16 upward pixels, including the impact tick, use the temporary speed');
    assert.equal(m[0x433 + slot], 104, 'the first rise reaches exactly one tile above its starting height');
    assert.equal(m[0x5C6 + slot], 0, 'reaching the target immediately clears the fright flag');
    assert.equal(m[0x5CE + slot], 0, 'reaching the target immediately clears the former distance tier');
    for(let i = 0; i < 4; i++) assert.equal(moveFrame(nes, slot), 0.5,
        'ordinary half-pixel patrol resumes on the frame after reaching the target');

    // An earlier ceiling obstruction may leave a higher destination pending.
    // A new impact boosts the whole outstanding climb, rather than starting
    // a fresh fixed number of fast frames.
    placeBird(m, slot, 56, 136); m[0x546 + slot] = 120; punch(nes);
    for(let i = 0; i < 19; i++) assert.equal(moveFrame(nes, slot), 2);
    const risingY = m[0x433 + slot];
    // Reposition only X beside the actual switch. Preserve the unfinished
    // height so another real B impact adds one tile to the rising target.
    m[0x50E + slot] = 0; m[0x516 + slot] = m[0x526 + slot] = 56; m[0x51E + slot] = 0;
    punch(nes);
    assert.equal(m[0x546 + slot], 88, 'another impact raises the target by another tile');
    assert.equal(m[0x433 + slot], risingY - 1, 'the second impact continues the current rise');
    while(m[0x433 + slot] > 88) assert.equal(moveFrame(nes, slot), 2, 'the renewed boost lasts until the new height');
    assert.equal(m[0x5C6 + slot], 0, 'the extended rise clears fright at its new target');
    assert.equal(m[0x5CE + slot], 0, 'the extended rise clears its distance tier');
    assert.equal(moveFrame(nes, slot), 0.5, 'the extended rise has no lingering fast frames');
});

realTest('real fright uses shortest wrapped horizontal distance across coordinate pages and map edges', () => {
    for(const [wide, playerX, x, left, speed] of [
        [false, 8, 248, true, 2], [true, 8, 504, true, 2],
        [true, 264, 250, true, 2], [true, 264, 280, false, 2],
        [true, 40, 360, true, 0.5]
    ]) {
        const data = stage(wide ? 4 : 0, wide, [], (playerX >> 4) + 1);
        const nes = start(data), m = nes.cpu.mem, slot = birdSlot(m);
        placeBird(m, slot, x, 120, left ? 4 : 3);
        punch(nes, playerX);
        assert.equal(m[0x556 + slot], left ? 3 : 4, `wide=${wide}, player=${playerX}, bird=${x}: escape direction`);
        for(let frame = 0; frame < 15; frame++) assert.equal(moveFrame(nes, slot, left), speed,
            `wide=${wide}, player=${playerX}, bird=${x}, frame=${frame}: speed uses the complete wrapped distance`);
        assert.equal(m[0x5C6 + slot], 0, 'the wrapped-distance reaction ends at its target height');
        assert.equal(moveFrame(nes, slot, left), 0.5, 'wrapped-distance flight also returns to ordinary patrol');
    }
});

realTest('pausing during real fright freezes the rise and resumes only the remaining fast ascent', () => {
    const nes = start(stage()), m = nes.cpu.mem, slot = birdSlot(m);
    placeBird(m, slot, 56); punch(nes);
    for(let i = 0; i < 10; i++) assert.equal(moveFrame(nes, slot), 2);
    nes.buttonDown(1, jsnes.Controller.BUTTON_START); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_START); nes.frame();
    assert.equal(m[0x32], 1, 'the native pause starts');
    const frozen = m.slice(0x400, 0x600);
    for(let i = 0; i < 120; i++) {
        nes.frame();
        assert.deepEqual(m.slice(0x400, 0x600), frozen, 'paused simulation retains all per-entity flight state');
    }
    nes.buttonDown(1, jsnes.Controller.BUTTON_START); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    for(let i = 0; i < 180 && m[0x32]; i++) nes.frame();
    assert.equal(m[0x32], 0, 'the native camera return completes');
    assert.ok(m[0x433 + slot] > m[0x546 + slot], 'the paused reaction still has upward pixels to travel');
    while(m[0x433 + slot] > m[0x546 + slot]) assert.equal(moveFrame(nes, slot), 2,
        '120 paused frames do not consume any of the remaining fast ascent');
    assert.equal(m[0x5C6 + slot], 0, 'the resumed rise ends its reaction at the target');
    assert.equal(moveFrame(nes, slot), 0.5, 'the resumed reaction has no extra fast tail');
});

realTest('bird and rider ceilings cancel fright while retaining the upward target at ordinary speed', () => {
    for(const rider of [false, true]) {
        const nes = start(stage(rider ? 4 : 0, false, rider ? [[9, 7, 13]] : []));
        const m = nes.cpu.mem, slot = birdSlot(m), height = rider ? 136 : 120;
        for(let other = 0; other < 8; other++) if(other !== slot) {
            m[0x4FE + other] = m[0x415 + other] = 0;
        }
        placeBird(m, slot, rider ? 136 : 56, height, rider ? 3 : 4);
        m[0x53E + slot] = Number(rider); m[0xD3] = 0;
        // Native packed terrain: row 6 is just above the bird's body in
        // the first case, and just above its rider's head in the second.
        m.fill(0x55, 0x760, 0x768);
        punch(nes, rider ? 136 : 40, rider ? 120 : 184);
        const left = m[0x556 + slot] === 3;
        assert.equal(m[0x433 + slot], height, `rider=${rider}: the native ceiling blocks the first upward pixel`);
        assert.equal(m[0x546 + slot], height - 16, 'blocking preserves the requested destination');
        assert.equal(m[0x5C6 + slot], 0, 'a blocked ascent immediately ends the reaction');
        assert.equal(m[0x5CE + slot], 0, 'a blocked ascent also clears the proximity tier');
        for(let i = 0; i < 10; i++) {
            assert.equal(moveFrame(nes, slot, left), 0.5, 'standing against a ceiling uses ordinary patrol speed');
            assert.equal(m[0x433 + slot], height, 'the ceiling cannot be entered while the boost is over');
        }
        m.fill(0, 0x760, 0x768);
        for(let i = 0; i < 16; i++) {
            assert.equal(moveFrame(nes, slot, left), 0.5, 'clearing the obstruction does not restart the boost');
            assert.equal(m[0x433 + slot], height - i - 1, 'the preserved target resumes one upward pixel per update');
            assert.equal(m[0x5C6 + slot], 0, 'an old target never reactivates fright');
        }
        assert.equal(m[0x433 + slot], height - 16, 'ordinary flight eventually reaches the retained target');
        assert.equal(moveFrame(nes, slot, left), 0.5, 'patrol remains ordinary after the delayed ascent completes');
    }
});

realTest('the fastest real fright carries the rider with stable OAM and reverses at solid walls', () => {
    for(const scene of [0, 4]) {
        const nes = start(stage(scene, false, [[9, 7, 13]]));
        const m = nes.cpu.mem, slot = birdSlot(m);
        for(let other = 0; other < 8; other++) if(other !== slot) {
            m[0x4FE + other] = m[0x415 + other] = 0;
        }
        placeBird(m, slot, 136, 136, 3); m[0x53E + slot] = 1; m[0xD3] = 0;
        punch(nes, 136, 120);
        const left = m[0x556 + slot] === 3;
        const sprites = tiles => {
            const result = [];
            for(let offset = 0; offset < 256; offset += 4) {
                if(m[0x200 + offset] < 240 && tiles.includes(m[0x201 + offset]))
                    result.push(m.slice(0x200 + offset, 0x204 + offset));
            }
            return result;
        };
        assert.equal(moveFrame(nes, slot, left), 2, 'the first fast carried step completes native switch-contact correction');
        const separation = (m[0xC2] - m[0x516 + slot] + 256) % 256;
        for(let i = 0; i < 30; i++) {
            assert.equal(moveFrame(nes, slot, left), i < 14 ? 2 : 0.5,
                `scene=${scene}, frame=${i}: rider uses temporary close-range speed only during ascent`);
            assert.equal(m[0x53E + slot], 1, 'fast transport retains the standing rider');
            assert.equal((m[0xC2] - m[0x516 + slot] + 256) % 256, separation, 'world X stays attached');
            assert.equal(m[0x41E], m[0x433 + slot] - 16, 'world Y stays attached');
            const player = sprites([0x04, 0x06, 0x10, 0x12]), bird = sprites([0xAA, 0xAC, 0xAE, 0xB0]);
            assert.equal(player.length, 2, 'both player sprite halves remain visible');
            assert.equal(bird.length, 2, 'both carrier sprite halves remain visible');
            // Native punching artwork shifts its two sprite halves four
            // pixels right until the usual standing artwork resumes.
            const artworkOffset = m[0x400] === 0x8C ? 4 : 0;
            assert.equal(Math.min(...player.map(sprite => sprite[3])) - Math.min(...bird.map(sprite => sprite[3])),
                separation + artworkOffset, 'hardware OAM uses carried X in the same frame');
            assert.ok(player.every(sprite => sprite[0] === bird[0][0] - 16), 'hardware OAM retains the exact support height');
        }
    }

    const wall = Array.from({ length: 7 }, (_, y) => [5, y + 3, 5]);
    const nes = start(stage(0, false, wall)), m = nes.cpu.mem, slot = birdSlot(m);
    placeBird(m, slot, 56); punch(nes);
    let bounced = false;
    for(let i = 0; i < 45; i++) {
        const before = m[0x516 + slot]; nes.frame();
        const after = m[0x516 + slot];
        assert.ok(after < 80, `a two-pixel step cannot tunnel into a wall: X=${after}`);
        if(after < before && m[0x556 + slot] === 3) bounced = true;
        assert.equal(m[0x506 + slot], 1, 'reversing at a wall keeps the auxiliary alive');
    }
    assert.ok(bounced, 'ordinary patrol wall reversal applies during fright');
});

realTest('a frightened bird completes native death and respawns with ordinary patrol speed', () => {
    const nes = start(stage(4, true)), m = nes.cpu.mem, slot = birdSlot(m);
    placeBird(m, slot, 56); punch(nes);
    assert.equal(moveFrame(nes, slot), 2, 'the checkpoint starts frightened');
    m[0x8B] = 2; m[0x8E] = 2; m[0x8C] = m[0x50E + slot];
    m[0x8D] = m[0x516 + slot]; m[0x43B] = m[0x433 + slot];
    nes.frame();
    assert.equal(m[0x506 + slot], 11, 'a native thrown stone still starts the tumble');
    m[0x8B] = m[0x8E] = 0;
    for(let i = 0; i < 200 && m[0x506 + slot] !== 13; i++) nes.frame();
    assert.equal(m[0x506 + slot], 13, 'the tumble reaches its native respawn delay');
    const deathTarget = m[0x546 + slot], deathDirection = m[0x556 + slot];
    punch(nes);
    assert.equal(m[0x506 + slot], 13, 'a new global event cannot frighten a defeated bird');
    assert.equal(m[0x546 + slot], deathTarget, 'the global event preserves native defeat physics');
    assert.equal(m[0x556 + slot], deathDirection, 'the global event does not redirect a defeated bird');
    let smoke = false, live = false;
    for(let i = 0; i < 1000; i++) {
        nes.frame();
        smoke ||= m[0x506 + slot] === 0;
        if(smoke && m[0x506 + slot] === 1) { live = true; break; }
    }
    assert.ok(smoke && live, 'ordinary smoke precedes the new live patrol');
    const left = m[0x556 + slot] === 3;
    for(let i = 0; i < 10; i++) assert.equal(moveFrame(nes, slot, left), 0.5,
        'respawn clears former fright speed and duration');

    // The appearance state is outside the global bird reaction, even when
    // a switch is punched while its smoke is already on screen.
    placeBird(m, slot, 120, 104, 3);
    m[0x506 + slot] = 0; m[0x55E + slot] = 0; m[0x566 + slot] = 1;
    punch(nes);
    assert.equal(m[0x506 + slot], 0, 'a real impact leaves the appearance animation active');
    assert.equal(m[0x546 + slot], 104, 'appearance does not acquire a rising target');
    assert.equal(m[0x556 + slot], 3, 'appearance does not react to the escape direction');
});
