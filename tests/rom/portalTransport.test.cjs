const {openSettings, backToMap} = require('../helpers/pause-settings.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');
const { Enemy, LevelCodec, Portal, Project, SpritePatterns } = require('../helpers/source.cjs').load('Enemy LevelCodec Portal Project SpritePatterns');

const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, body) => test(name, {skip: !original}, body);
const ram = Portal.PORTAL_RAM;
const pair = [{enemyId: 13, x: 8, y: 11}, {enemyId: 13, x: 11, y: 7}];
function stage({portals = pair, stone = true, blocked = false, wide = false, camera = false, scene = 0,
    playerX = 3, playerY = 11, changeMap = () => {}} = {}) {
    const editor = new Project(); editor.loadROM(original);
    editor.gameConfig.disableTimer = true; editor.gameConfig.cameraFollow = camera;
    const map = Array.from({length: 14}, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(5); map[1][2] = 15;
    for (const p of portals) if (p.y < 11) map[p.y + 1][p.x] = 5;
    if (stone) map[portals[0].y][portals[0].x] = 10;
    if (blocked) map[portals[1].y][portals[1].x] = 5;
    changeMap(map);
    const data = LevelCodec.fromLevelEditorToROMData({background: scene | (wide ? 16 : 0), map,
        player: {x: playerX, y: playerY}, door: {x: 14, y: 10}, enemies: portals}, wide);
    editor.levels[0].data = data.mapData; editor.levels[0].monsterData = data.monsterData;
    editor.levelCount = 1; return editor.getROMData();
}
function frames(n, count) { for (let f = 0; f < count; f++) n.frame(); }
function press(n, key) { n.buttonDown(1, key); n.frame(); n.buttonUp(1, key); n.frame(); }
function start(rom) {
    const n = new jsnes.NES({onFrame() {}, emulateSound: false});
    n.loadROM(Buffer.from(rom).toString('binary')); frames(n, 160); press(n, jsnes.Controller.BUTTON_START);
    for (let f = 0; f < 700; f++) {
        n.frame(); const m = n.cpu.mem;
        if (m[0x30] === 12 && m[0x56] === 3 && !(m[0x2A] & 128)) return n;
    }
    assert.fail('Gameplay did not start');
}
function tile(n, x, y) { const value = n.cpu.mem[0x700 + y * 16 + (x >> 1)]; return x & 1 ? value & 15 : value >> 4; }
function position(n) { const m = n.cpu.mem; return [m[0xC1] * 256 + m[0xC2], m[0x41E]]; }

test('pair IDs use only bits 4/5 and survive editor encoding across screens', () => {
    for (const flags of [0, 0x40, 0x80, 0xC0]) {
        const portal = new Enemy(13 | flags, flags & 128 ? 24 : 8, 7);
        for (let id = 1; id <= 4; id++) {
            assert.equal(portal.getPortalPairId(), id);
            assert.equal(portal.enemyId & 0xCF, 13 | flags);
            const decoded = LevelCodec.decodeMonsterData(LevelCodec.encodeMonsterData([portal]))[0];
            assert.equal(decoded.id, portal.enemyId);
            assert.equal(decoded.x + (decoded.id & 128 ? 16 : 0), portal.x);
            portal.reverseFacing();
        }
        assert.equal(portal.enemyId, 13 | flags);
    }
    const enemy = new Enemy(12, 8, 7); enemy.reverseFacing(); assert.equal(enemy.enemyId, 0x4C);
});

test('live cargo arrival clips every object pool using camera borrow and map-width wrapping', () => {
    const data = new Uint8Array(0x20010);
    data.set([0x4E, 0x45, 0x53, 0x1A, 8, 0, 0x21]);
    const {labels} = Portal.addPortalTransport(data);
    const n = new jsnes.NES({onFrame() {}, emulateSound: false});
    n.loadROM(Buffer.from(data).toString('binary'));
    n.mmap.write(0x8000, 1);
    const c = n.cpu, m = c.mem;
    for (const [kind, slot, x, page, y, screenX, meta] of [
        [3, 0, 0x4F8, 0x4F5, 0x430, 0x44E, 0x412],
        [3, 2, 0x4F8, 0x4F5, 0x430, 0x44E, 0x412],
        [4, 0, 0x8D, 0x8C, 0x43B, 0x459, 0x41D],
        [5, 1, 0x4B0, 0x4AC, 0x42B, 0x449, 0x40D],
        [2, 5, 0x516, 0x50E, 0x433, 0x451, 0x415]
    ]) for (const [wide, cameraX, targetX] of [
        [1, 0, 392], [1, 384, 136], [1, 500, 8],
        [1, 8, 264], [1, 9, 264], [1, 392, 392], [0, 200, 8]
    ]) {
        m[ram.owner] = 7; m[ram.destination] = 6;
        m[0x3D] = wide; m[0xFD] = cameraX & 255; m[0x9D] = cameraX >> 8;
        m[0x516 + 6] = targetX & 255; m[0x50E + 6] = targetX >> 8; m[0x433 + 6] = 120;
        m[0x4FE + slot] = 1; m[meta + slot] = 0x16;
        // Run the real bank-1 transfer branch, returning to a RAM trampoline.
        m[0x600] = 0x20; m[0x601] = labels.liveCargo & 255; m[0x602] = labels.liveCargo >> 8;
        c.REG_PC = 0x5FF; c.REG_SP = 0x1FF; m[4] = kind; c.REG_Y = slot;
        c.irqRequested = false;
        for (let steps = 0; steps < 1000 && c.REG_PC !== 0x602; steps++) c.emulate();
        const context = `kind=${kind}, slot=${slot}, wide=${wide}, camera=${cameraX}, exit=${targetX}`;
        assert.equal(c.REG_PC, 0x602, context); assert.equal(c.REG_SP, 0x1FF, context);
        assert.deepEqual([m[page + slot] * 256 + m[x + slot], m[y + slot]], [targetX, 120], context);
        const projected = (targetX - cameraX + 512) % (wide ? 512 : 256);
        assert.equal(m[screenX + slot], projected & 255, context);
        assert.equal(m[meta + slot], projected < 256 ? 0x16 : 0, context);
    }
});

realTest('a supported stone travels back and forth without duplicate fall watchers', () => {
    const n = start(stage()), m = n.cpu.mem;
    frames(n, 20); assert.equal(tile(n, 8, 11), 0); assert.equal(tile(n, 11, 7), 10);
    assert.equal(m[ram.partner + 7], 6); assert.equal(m[ram.partner + 6], 7);
    for (let cycle = 1; cycle <= 6; cycle++) {
        frames(n, 300);
        assert.deepEqual([tile(n, 8, 11), tile(n, 11, 7)], cycle & 1 ? [10, 0] : [0, 10]);
        assert.equal(Array.from(m.slice(0x4C0, 0x4CA)).filter(Boolean).length, 1);
        assert.equal(m[0x56], 3);
    }
});

realTest('an animated entry and a hollow exit swap at 300 ticks and freeze during pause', () => {
    const n = start(stage({stone: false})), m = n.cpu.mem;
    frames(n, 8);
    assert.deepEqual([m[ram.visual + 7], m[ram.visual + 6]], [1, 6]);
    frames(n, 291); assert.deepEqual([m[ram.role + 7], m[ram.role + 6]], [0, 1]);
    frames(n, 1); assert.deepEqual([m[ram.role + 7], m[ram.role + 6]], [1, 0]);
    press(n, jsnes.Controller.BUTTON_START); frames(n, 20);
    const snapshot = () => [ram.role, ram.clockLow, ram.clockHigh, 0x55E, 0x566]
        .flatMap(address => Array.from(m.slice(address + 6, address + 8)));
    const frozen = snapshot(); frames(n, 90); assert.deepEqual(snapshot(), frozen);
    press(n, jsnes.Controller.BUTTON_START); frames(n, 20); assert.notDeepEqual(snapshot(), frozen);
});

realTest('players enter automatically and travel back after changeover, including across screens', () => {
    for (const wide of [false, true]) for (const camera of [false, true]) {
        const targetX = wide ? 24 : 11;
        const n = start(stage({stone: false, playerX: 8, wide, camera,
            portals: [pair[0], {enemyId: 13, x: targetX, y: 7}]}));
        frames(n, 30);
        assert.deepEqual(position(n), [targetX * 16 + 8, 120]);
        frames(n, 250); assert.deepEqual(position(n), [targetX * 16 + 8, 120]);
        frames(n, 40);
        assert.deepEqual(position(n), [136, 184]);
    }
});

realTest('only a successful departure plays the three native closing poses, without scrolling for cargo', () => {
    for (const blocked of [false, true]) {
        const n = start(stage({blocked})), m = n.cpu.mem, poses = [];
        const camera = m[0xFD] + 256 * m[0x9D];
        for (let frame = 0; frame < 46; frame++) {
            n.frame();
            const meta = m[0x415 + 7];
            if ([0x10, 0x0F, 0x0E].includes(meta) && poses.at(-1) !== meta) poses.push(meta);
            assert.equal(m[ram.panTicks], 0);
            assert.equal(m[0xFD] + 256 * m[0x9D], camera);
            assert.ok(![0x10, 0x0F, 0x0E].includes(m[0x415 + 6]), 'exit keeps its outline');
        }
        assert.deepEqual(poses, blocked ? [] : [0x10, 0x0F, 0x0E]);
        assert.equal(tile(n, 11, 7), blocked ? 5 : 10);
    }
});

realTest('a player pan takes sixteen live steps in either direction and resumes from its paused position', () => {
    for (const camera of [false, true]) {
        const n = start(stage({wide: true, camera, stone: false, playerX: 3,
            portals: [pair[0], {enemyId: 13, x: 22, y: 7}]})), m = n.cpu.mem;
        const scroll = () => m[0xFD] + 256 * m[0x9D];
        const offset = (a, b) => ((a - b + 768) % 512) - 256;
        frames(n, 25);
        m[0xC1] = 0; m[0xC2] = 136; m[0x41E] = 184;
        for (const [cycle, target] of [232, 8].entries()) {
            for (let f = 0; f < 350 && m[ram.panTicks] !== 16; f++) n.frame();
            assert.equal(m[ram.panTicks], 16);
            const initial = scroll(), direction = Math.sign(offset(target, initial));
            let previous = initial, remaining = 16;
            for (let f = 0; f < 48 && remaining; f++) {
                n.frame();
                if (m[ram.panTicks] === remaining) continue;
                assert.equal(m[ram.panTicks], --remaining);
                const step = offset(scroll(), previous);
                assert.equal(Math.sign(step), direction);
                assert.ok(Math.abs(step) <= 16);
                assert.equal(m[0xFF] & 1, m[0x9D]);
                previous = scroll();
                if (remaining === 10 && cycle === 0) {
                    press(n, jsnes.Controller.BUTTON_START);
                    const held = m[ram.panTicks], heldScroll = scroll();
                    frames(n, 24);
                    openSettings(n);
                    assert.equal(m[ram.panTicks], held);
                    backToMap(n);
                    assert.equal(m[ram.panTicks], held); assert.equal(scroll(), heldScroll);
                    press(n, jsnes.Controller.BUTTON_START);
                }
            }
            assert.equal(remaining, 0); assert.equal(scroll(), target);
        }
    }
});

realTest('walking past a camera page boundary with portals keeps one background page per visible frame', () => {
    const n = start(stage({wide: true, camera: true, stone: false, playerX: 6,
        portals: [{enemyId: 13, x: 3, y: 7}, {enemyId: 13, x: 19, y: 7}]}));
    const m = n.cpu.mem;
    m[0x2A] = 1; // Centered looping view.
    frames(n, 4);
    const write = n.mmap.write.bind(n.mmap);
    n.mmap.write = (address, value) => {
        if (address === 0x2000 && n.ppu.scanline >= 20 && n.ppu.scanline <= 260 && n.ppu.f_bgVisibility)
            assert.equal(value & 1, n.ppu.regH, `background page changed on scanline ${n.ppu.scanline}`);
        return write(address, value);
    };
    for (const [key, page] of [[jsnes.Controller.BUTTON_RIGHT, 0], [jsnes.Controller.BUTTON_LEFT, 1]]) {
        assert.notEqual(m[0x9D], page);
        n.buttonDown(1, key);
        frames(n, 48);
        n.buttonUp(1, key);
        assert.equal(m[0x9D], page);
        assert.equal(m[ram.panTicks], 0);
    }
});

realTest('changeover contracts the entrance, holds the hollow exit, disables entry, expands, then swaps direction', () => {
    const n = start(stage({stone: false})), m = n.cpu.mem;
    frames(n, 240);
    assert.deepEqual([m[ram.visual + 7], m[ram.visual + 6]], [4, 6]);
    m[0xC2] = 136; m[0x41E] = 184; m[0xC0] = 1;
    frames(n, 20); assert.deepEqual(position(n), [136, 184]);
    assert.deepEqual([m[ram.visual + 7], m[ram.visual + 6]], [5, 6]);
    frames(n, 25); assert.deepEqual(position(n), [136, 184]);
    assert.deepEqual([m[ram.visual + 7], m[ram.visual + 6]], [4, 6]);
    m[0xC2] = 184; m[0x41E] = 120;
    frames(n, 14); assert.deepEqual(position(n), [184, 120]);
    frames(n, 5); assert.deepEqual(position(n), [136, 184]);
    assert.deepEqual([m[ram.role + 7], m[ram.role + 6]], [1, 0]);
    assert.ok(m[ram.visual + 7] === 6 && m[ram.visual + 6] < 4);
});

realTest('stone travel changes only the covered endpoint to sprites and restores the vacated background', () => {
    const n = start(stage()), m = n.cpu.mem;
    const cell = (x, y) => [0, 1, 32, 33].map(offset => n.ppu.vramMem[0x2000 + y * 64 + x * 2 + offset]);
    frames(n, 30);
    assert.deepEqual([m[ram.overlay + 7], m[ram.overlay + 6]], [0, 1]);
    assert.equal(m[0x415 + 7], 0); assert.ok(m[0x415 + 6] >= 0x2F);
    assert.ok(SpritePatterns.PORTAL_FRAMES.some(frame => frame.join() === cell(8, 11).join()));
    frames(n, 300);
    assert.deepEqual([m[ram.overlay + 7], m[ram.overlay + 6]], [1, 0]);
    assert.equal(m[0x415 + 6], 0); assert.ok(m[0x415 + 7] >= 0x2F);
    assert.ok(SpritePatterns.PORTAL_FRAMES.some(frame => frame.join() === cell(11, 7).join()));
});

realTest('falling stones temporarily cover an empty portal and its background returns after passage', () => {
    const portals = [...pair, {enemyId: 0x1D, x: 11, y: 9}];
    const n = start(stage({portals, changeMap: map => {map[8][11] = 0; map[10][11] = 0;}})), m = n.cpu.mem;
    let seen = false;
    for (let frame = 0; frame < 150; frame++) {
        n.frame();
        if (frame > 10 && m[ram.overlay + 5] === 1 && tile(n, 11, 9) === 0) seen = true;
    }
    assert.ok(seen); assert.equal(m[ram.overlay + 5], 0);
    assert.equal(tile(n, 11, 11), 10);
});

realTest('blocked exits preserve the source; unsupported arrivals fall using native physics', () => {
    const blocked = start(stage({blocked: true})); frames(blocked, 330);
    assert.deepEqual([tile(blocked, 8, 11), tile(blocked, 11, 7)], [10, 5]);
    const player = start(stage({stone: false, blocked: true, playerX: 8})); frames(player, 20);
    press(player, jsnes.Controller.BUTTON_UP); assert.deepEqual(position(player), [134, 184]);
    const falling = start(stage({changeMap: map => {map[8][11] = 0;}})); frames(falling, 150);
    assert.equal(tile(falling, 8, 11), 0); assert.equal(tile(falling, 11, 7), 0);
    assert.equal(tile(falling, 11, 11), 10);
});

realTest('only exactly two same-number portals pair; multiple groups remain independent', () => {
    for (const portals of [[pair[0]], [pair[0], {...pair[1], enemyId: 0x1D}],
        [...pair, {enemyId: 13, x: 5, y: 7}]]) {
        const n = start(stage({portals})); frames(n, 40);
        assert.equal(tile(n, 8, 11), 10); assert.equal(n.cpu.mem[ram.partner + 7], 255);
    }
    const portals = [...pair, {enemyId: 0x3D, x: 5, y: 11}, {enemyId: 0xFD, x: 24, y: 7}];
    const n = start(stage({portals, wide: true, changeMap: map => {map[11][5] = 10;}}));
    frames(n, 30);
    assert.deepEqual([tile(n, 8, 11), tile(n, 11, 7), tile(n, 5, 11), tile(n, 24, 7)], [0, 10, 0, 10]);
    assert.deepEqual(Array.from(n.cpu.mem.slice(ram.group + 4, ram.group + 8)), [3, 3, 0, 0]);
    frames(n, 300);
    assert.deepEqual([tile(n, 8, 11), tile(n, 11, 7), tile(n, 5, 11), tile(n, 24, 7)], [10, 0, 10, 0]);
});

realTest('transport ROM export is repeatable and retains group metadata', () => {
    const rom = stage({portals: pair.map(p => ({...p, enemyId: 0x2D}))});
    assert.deepEqual(stage({portals: pair.map(p => ({...p, enemyId: 0x2D}))}), rom);
    const n = start(rom); frames(n, 20);
    assert.equal(n.cpu.mem[ram.group + 7], 2); assert.equal(tile(n, 11, 7), 10);
});

realTest('all fifteen map tile IDs move intact, including rescue heads, with no change to the rescue count', () => {
    for (let id = 1; id <= 15; id++) {
        const n = start(stage({stone:false, changeMap: map => {map[11][8] = id;}}));
        const rescues = n.cpu.mem[0x43]; frames(n, 32);
        assert.deepEqual([tile(n, 8, 11), tile(n, 11, 7)], [0, id], 'tile ' + id);
        assert.equal(n.cpu.mem[0x43], rescues);
        frames(n, 300);
        assert.deepEqual([tile(n, 8, 11), tile(n, 11, 7)], [id, 0], 'return ' + id);
    }
});

realTest('live objects cross screens in their own slots, including projectiles and armed bombs', () => {
    const data = stage({stone:false, wide:true, portals:[pair[0], {...pair[1], x:24}]});
    const n = start(data), m = n.cpu.mem;
    const active = () => {m[ram.cooldown + 7] = m[ram.cooldown + 6] = 0;};
    for (const [state, page, x, y, value] of [
        [0x4A8, 0x4AC, 0x4B0, 0x42B, 3], [0x8B, 0x8C, 0x8D, 0x43B, 2],
        [0x4F2, 0x4F5, 0x4F8, 0x430, 7], [0x4F3, 0x4F6, 0x4F9, 0x431, 7]
    ]) {
        active(); m[state] = value; m[x] = 136; m[page] = 0; m[y] = 184;
        m[0x8E] = 8; m[0x4FB] = m[0x4FC] = 8;
        frames(n, 2); assert.deepEqual([m[page],m[x],m[y]], [1,136,120], 'object ' + state.toString(16));
        assert.ok(m[state]); m[state] = 0;
    }
    for (const id of [1,2,3,4,5,6,7,8,10,11,12]) {
        active(); const slot = 5; m[0x4FE+slot] = id; m[0x506+slot] = 1;
        m[0x516+slot] = 136; m[0x50E+slot] = 0; m[0x433+slot] = m[0x546+slot] = 184;
        const spawn = m[0x576+slot]; n.frame();
        assert.equal(m[0x50E+slot], 1, 'live type ' + id);
        assert.ok(Math.abs(m[0x433+slot]-120) <= 4, 'height ' + id);
        assert.equal(m[0x576+slot], spawn); m[0x4FE+slot] = 0;
    }
});

realTest('a falling metatile can enter mid-drop; the two statue collision cells stay fixed', () => {
    const n = start(stage({stone:false, changeMap: map => {map[10][8] = 10; map[12][8] = 0;}}));
    const m = n.cpu.mem;
    m[0x4C0] = 0xFF; m[0x4CA] = 10; m[0x4D4] = 16; m[0x4DE] = 20;
    frames(n, 110); assert.equal(tile(n,11,7), 10);
    for (const y of [10, 11]) {
        const s = start(stage({stone:false, portals:[{...pair[0],y},pair[1],{enemyId:9,x:8,y:11}]}));
        frames(s, 36); assert.equal(tile(s,8,y), 1); assert.equal(tile(s,11,7),0);
    }
});

realTest('a rolled stone entering a portal is clipped immediately at an off-screen exit', () => {
    for (const camera of [false, true]) for (const targetX of [24, 11]) {
        const n = start(stage({wide: true, camera, stone: false, playerX: 6,
            portals: [{enemyId: 13, x: 8, y: 12}, {enemyId: 13, x: targetX, y: 7}],
            changeMap: map => {
                map[11][7] = 10; map[12][8] = map[12][9] = 0;
                map[8][targetX] = 0; // Let the arrival continue falling to the floor.
            }}));
        const m = n.cpu.mem, context = `camera=${camera}, exit=${targetX}`;
        let rolled = false, falling = false, arrived = false;
        n.buttonDown(1, jsnes.Controller.BUTTON_RIGHT);
        for (let f = 0; f < 100; f++) {
            n.frame();
            rolled ||= m[0xC0] === 3;
            falling ||= m[0x4F2] === 10 && m[0x430] >= 184;
            if (tile(n, targetX, 7) !== 10) continue;
            assert.equal(m[0x4F2], 0, `${context}: arrival is now owned by map physics`);
            assert.equal(m[0x412], 0, `${context}: arrival must not retain a stale moving sprite`);
            arrived = true;
            break;
        }
        n.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
        assert.ok(rolled && falling && arrived, `${context}: push, fall, and transfer all ran`);
        frames(n, 60);
        assert.equal(tile(n, targetX, 11), 10, `${context}: the stone falls in the exit's column`);
    }
});

realTest('screenshot layout: two headbutted rocks roll into 1A and stack separately below 1B', () => {
    for (const camera of [false, true]) {
        const n = start(stage({wide: true, camera, stone: false, playerX: 5, playerY: 2,
            portals: [{enemyId: 13, x: 18, y: 4}, {enemyId: 13, x: 3, y: 8},
                {enemyId: 29, x: 12, y: 6}, {enemyId: 29, x: 15, y: 10}],
            changeMap: map => {
                // Recreate the screenshot's corridors, four stock rocks, and
                // both portal pairs. The breakable hatch above 1A is open.
                map.forEach(row => row.fill(0));
                map[3].fill(5); map[5].fill(5, 0, 21);
                map[7].fill(5, 0, 17); map[10].fill(5, 0, 15);
                for (let y = 3; y < 14; y++) {
                    map[y].fill(5, 0, 3); map[y][17] = 5; map[y].fill(5, 23);
                    if (y >= 5) map[y][20] = 5;
                    if (y >= 5 && y <= 10) map[y][14] = 5;
                }
                map[8].fill(5, 17, 21); map[10].fill(5, 20, 23);
                for (const x of [15, 16, 18, 19]) map[11][x] = 5;
                for (const x of [6, 8, 10]) map[6][x] = 15;
                for (const x of [16, 18]) map[10][x] = 15;
                for (const x of [21, 23, 25, 27]) map[2][x] = 10;
                map[3][18] = 0;
            }})), m = n.cpu.mem;
        const countRocks = () => Array.from({length: 14 * 32}, (_, cell) =>
            tile(n, cell % 32, Math.floor(cell / 32))).filter(id => id === 10).length;
        for (const [index, column] of [21, 23].entries()) {
            // Position the player at the stockpile, then use the actual B
            // input: native rolling, falling, portal entry and landing run.
            const playerX = (column + 1) * 16 + 8;
            m[0xC1] = playerX >> 8; m[0xC2] = playerX & 255;
            m[0x41E] = 40; m[0xCB] = 3; m[0xC0] = 1;
            m[0xC4] = m[0xC7] = m[0xC8] = 0;
            n.buttonDown(1, jsnes.Controller.BUTTON_B); n.frame();
            n.buttonUp(1, jsnes.Controller.BUTTON_B);
            let rolled = m[0x8B] === 1, fell = false;
            for (let f = 0; f < 89; f++) {
                n.frame(); rolled ||= m[0x8B] === 1; fell ||= m[0x8B] === 3;
            }
            const context = `camera=${camera}, rock=${index + 1}`;
            assert.ok(rolled && fell, `${context}: headbutt rolls then drops the rock`);
            assert.deepEqual([tile(n, 3, 8), tile(n, 3, 9)], index ? [10, 10] : [0, 10], context);
            assert.equal(m[0x8B], 0, `${context}: no leftover rolling object`);
            assert.equal(countRocks(), 4, `${context}: no lost or duplicate rocks`);
        }
    }
});

realTest('falling rock arrivals preserve immediate support and retire their sprites only after committing', () => {
    // The production build chains the bird renderer with a three-byte JMP.
    const {labels} = Portal.addSpritePortalPreview(new Uint8Array(0x20010), 0xFD00);
    for (const camera of [false, true]) for (const rolling of [false, true]) {
        const n = start(stage({stone: false, camera})), c = n.cpu, m = c.mem;
        const [active, x, page, y, meta, value] = rolling
            ? [0x8B, 0x8D, 0x8C, 0x43B, 0x41D, 3]
            : [0x4F2, 0x4F8, 0x4F5, 0x430, 0x412, 10];
        m[active] = value; m[x] = 136; m[page] = 0; m[y] = 184; m[meta] = 0x16;
        m[0x4FB] = 4;
        const tick = () => {
            m[0x600] = 0x20; m[0x601] = labels.transport & 255; m[0x602] = labels.transport >> 8;
            c.REG_PC = 0x5FF; c.REG_SP = 0x1FF; c.REG_ACC = 1; c.REG_X = 7;
            c.irqRequested = false;
            for (let steps = 0; steps < 20000 && c.REG_PC !== 0x602; steps++) c.emulate();
            assert.equal(c.REG_PC, 0x602); assert.equal(c.REG_SP, 0x1FF);
        };
        m[0x1E] = 16; tick(); // A redraw is already queued: keep the source alive.
        assert.equal(m[active], value); assert.equal(m[meta], 0x16);
        assert.equal(tile(n, 11, 7), 0);
        m[0x1E] = 0; tick();
        assert.equal(m[active], 0); assert.equal(m[meta], 0);
        assert.deepEqual([tile(n, 11, 7), tile(n, 11, 8)], [10, 5]);
        assert.equal(m[ram.cooldown + 7], 30);
    }
});

realTest('legacy overlapping portals keep their background cell through all native exit animation phases', () => {
    const n = start(stage({portals:[{enemyId:13,x:15,y:11}], stone:false}));
    frames(n,35); const m = n.cpu.mem, cell = () => [0,1,32,33].map(o => n.ppu.vramMem[0x2000+11*64+30+o]);
    assert.ok(SpritePatterns.PORTAL_FRAMES.some(f => f.join() === cell().join()));
    m[0x43] = 0; m[0xC2] = 241;
    const phases = new Set();
    for (let i = 0; i < 300; i++) {
        n.frame(); if (m[0x30] !== 13) continue;
        phases.add(m[0x62]); assert.ok(SpritePatterns.PORTAL_FRAMES.some(f => f.join() === cell().join()));
    }
    assert.deepEqual(phases,new Set([1,2,3]));
});

realTest('a player blocks arriving stones, and removing support releases the stone above', () => {
    const n = start(stage({playerX: 11, portals: [pair[0], {...pair[1], y: 11}]}));
    frames(n, 40); assert.deepEqual([tile(n, 8, 11), tile(n, 11, 11)], [10, 0]);
    n.buttonDown(1, jsnes.Controller.BUTTON_RIGHT); frames(n, 30); n.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
    assert.deepEqual([tile(n, 8, 11), tile(n, 11, 11)], [0, 10]);
    const stacked = start(stage({changeMap: map => {map[10][8] = 10;}})); frames(stacked, 160);
    assert.deepEqual([tile(stacked, 8, 10), tile(stacked, 8, 11), tile(stacked, 11, 7)], [0, 10, 10]);
});

realTest('four active pairs keep bank switches safe and PPU painting within vblank', () => {
    for (const scene of [0, 3, 7, 8]) for (const camera of [false, true]) {
        const portals = Array.from({length: 4}, (_, group) => [
            {enemyId: 13 | group << 4, x: 2 + group * 3, y: 11},
            {enemyId: 13 | group << 4, x: 2 + group * 3, y: 7}]).flat();
        const n = start(stage({portals, scene, camera, playerX: 14, changeMap: map => {
            for (let group = 0; group < 4; group++) map[11][2 + group * 3] = 10;
        }}));
        const write = n.mmap.write.bind(n.mmap);
        let bankSwitches = 0;
        n.mmap.write = (address, value) => {
            if (address === 0x8000 && value === 1 && n.cpu.mem[ram.bankActive]) {
                // Interrupt the first switch before the worker's JSR. Its
                // bank has no native NMI handler at $8081.
                if (++bankSwitches === 1) {
                    assert.ok(n.ppu.f_nmiOnVblank);
                    n.cpu.requestIrq(n.cpu.IRQ_NMI);
                }
            }
            if (address === 0x2005 || address === 0x2007) assert.ok(n.ppu.scanline < 20,
                `scene=${scene} camera=${camera} line=${n.ppu.scanline}`);
            return write(address, value);
        };
        // Count gameplay role changes rather than assuming every video frame
        // completes a game update under the NES's eight-object workload.
        let previous = n.cpu.mem[ram.role + 7], swaps = 0;
        for (let f = 0; f < 900; f++) {
            n.frame(); const role = n.cpu.mem[ram.role + 7];
            if (role !== previous) { swaps++; previous = role; }
            if (swaps >= 2 && portals.filter((_, i) => i % 2 === 0).every(p => tile(n, p.x, p.y) === 0)) break;
        }
        assert.equal(swaps, 2); assert.ok(bankSwitches > 100);
        for (let group = 0; group < 4; group++) {
            assert.equal(tile(n, 2 + group * 3, 11), 0);
            assert.equal(tile(n, 2 + group * 3, 7), 10);
        }
    }
});

realTest('background portal animation shares the queue with fire and native scene animation', () => {
    for (const camera of [false, true]) for (const scene of [3, 8]) {
        const n = start(stage({camera, scene, stone: false, portals: [...pair,
            {enemyId: 9, x: 13, y: 4}]}));
        const write = n.mmap.write.bind(n.mmap);
        n.mmap.write = (address, value) => {
            if (address === 0x2005 || address === 0x2007) assert.ok(n.ppu.scanline < 20,
                `fire/portal scene=${scene} camera=${camera} line=${n.ppu.scanline}`);
            return write(address, value);
        };
        frames(n, 600);
        assert.equal(n.cpu.mem[0x4FE + 5], 9);
        assert.equal(n.cpu.mem[ram.overlay + 7], 0);
        assert.equal(n.cpu.mem[ram.overlay + 6], 0);
    }
});
