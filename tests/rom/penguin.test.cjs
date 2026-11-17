const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');
const {Project, Penguin, SpritePatterns, LevelCodec, EditorToolbar, ResourceManager, BirdFish, Hud, GraphicsCatalog} =
    require('../helpers/source.cjs').load('Project Penguin SpritePatterns LevelCodec EditorToolbar ResourceManager BirdFish Hud GraphicsCatalog',
        {document: {addEventListener() {}, getElementById() {return {};}}});
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, body) => test(name, {skip: !original}, body);

function stage({scene = 6, wide = false, camera = false, facing = 0, wall = false, ledge = false, playerAway = false, floorTile = 5} = {}) {
    const p = new Project(); p.loadROM(original); p.gameConfig.disableTimer = true; p.gameConfig.cameraFollow = camera;
    const map = Array.from({length: 14}, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(floorTile); map[1][2] = 15;
    if (wall) for (const row of [10, 11]) {map[row][3] = 5; map[row][12] = 5;}
    if (ledge) {map[12].fill(0);map[12].fill(floorTile, 4, 12);}
    if (playerAway) map[2].fill(5);
    const data = LevelCodec.fromLevelEditorToROMData({background: scene | (wide ? 16 : 0),
        map, player: {x: 6, y: playerAway ? 1 : 11}, door: {x: 14, y: 10}, enemies: [{enemyId: 15 | facing, x: 8, y: 11}]}, wide);
    p.levels[0].data = data.mapData; p.levels[0].monsterData = data.monsterData; p.levelCount = 1;
    return p.getROMData();
}
function start(options) {
    const n = new jsnes.NES({onFrame() {}, emulateSound: false});
    n.loadROM(Buffer.from(stage(options)).toString('binary'));
    for (let i = 0; i < 160; i++) n.frame();
    n.buttonDown(1, jsnes.Controller.BUTTON_START); n.frame(); n.buttonUp(1, jsnes.Controller.BUTTON_START);
    for (let i = 0; i < 700; i++) {
        n.frame(); const m = n.cpu.mem;
        const penguin = m.slice(0x4FE, 0x506).indexOf(15);
        if (m[0x30] === 12 && m[0x56] === 3 && !(m[0x2A] & 128) &&
            (!Penguin.ENABLED || (penguin >= 0 && m[0x506 + penguin] === 1))) return n;
    }
    assert.fail('gameplay not reached');
}
const slot = m => m.slice(0x4FE, 0x506).indexOf(15);
const pos = (m, s) => m[0x516 + s] + 256 * m[0x50E + s];

realTest('native foot tiles form standing and alternate steps, with a fixed left-facing head and player palette', async () => {
    const frames = SpritePatterns.getPenguinFrames(original);
    const tile = (frame, columnTile) => Buffer.from(frames.slice(frame * 64 + columnTile * 16, frame * 64 + columnTile * 16 + 16));
    const native = index => original.subarray(0xA010 + index * 16, 0xA020 + index * 16);
    const flip = bytes => Buffer.from([...bytes].map(byte => parseInt(byte.toString(2).padStart(8, '0').split('').reverse().join(''), 2)));
    for (let frame = 0; frame < 3; frame++) {
        assert.deepEqual(tile(frame, 0), flip(native(0xAE)), 'native right-facing head is mirrored left');
        assert.deepEqual(tile(frame, 2), flip(native(0xAC)), 'upper body stays fixed across all poses');
    }
    assert.deepEqual(tile(0, 1), native(0xAD));
    assert.deepEqual(tile(0, 3), flip(native(0xAD)), 'standing uses the same foot on both sides');
    assert.deepEqual(tile(1, 1), flip(native(0xAF)));
    assert.deepEqual(tile(1, 3), flip(native(0xAD)));
    assert.deepEqual(tile(2, 1), native(0xAD));
    assert.deepEqual(tile(2, 3), native(0xAF));
    assert.notDeepEqual(frames.slice(64, 128), frames.slice(128));
    const resources = new ResourceManager();
    resources.palettes = Array.from({length: 12}, () => Array.from({length:32}, (_, i) => i));
    resources.createImage = async (pixels, width, height) => ({pixels, width, height});
    await resources.loadBgResources(original);
    assert.equal(resources.getResource(0, 'enemy_15').width, 16);
    assert.equal(resources.getResource(0, 'enemy_15').height, 16);
    const colors = new Set(resources.getResource(0, 'enemy_15').pixels.flat().map(pixel => pixel.color));
    assert.deepEqual([...colors].sort((a,b) => a-b), [16, 17, 18, 19], 'preview uses player palette');
    for (const scene of [0, 4, 5, 6, 9, 10, 11]) {
        const n = start({scene});
        assert.ok(slot(n.cpu.mem) >= 0);
        assert.deepEqual(Uint8Array.from(n.ppu.vramMem.slice(0xB20, 0xBE0)), frames);
        n.frame(); n.frame();
        const attrs = [];
        for (let o = 0; o < 256; o += 4) if (n.ppu.spriteMem[o + 1] >= 0xB2 && n.ppu.spriteMem[o + 1] < 0xBE)
            attrs.push(n.ppu.spriteMem[o + 2] & 3);
        assert.ok(attrs.length >= 2, 'penguin is visible in native OAM');
        assert.ok(attrs.every(attr => attr === 0), 'both columns use the player palette');
    }
});

realTest('walking is continuous in both directions and camera modes, including world seams', () => {
    for (const wide of [false, true]) for (const camera of [false, true]) for (const facing of [0, 64]) {
        const n = start({wide, camera, facing, playerAway:true}), m = n.cpu.mem, s = slot(m);
        assert.ok(s >= 0);
        const sign = m[0x556 + s] === 4 ? 1 : -1, width = wide ? 512 : 256;
        const seen = new Set(); let moved = 0;
        for (let i = 0; i < 400; i++) {
            const before = pos(m, s); n.frame();
            const delta = ((pos(m, s) - before) * sign + width) % width;
            assert.ok(delta === 0 || delta === 1);
            const phase = m[0x566 + s];
            moved += delta;
            if (m[0x415 + s]) {
                seen.add(m[0x415 + s]);
                assert.equal(m[0x415 + s], Penguin.META + 1 + ((phase >> 3) & 1), 'alternate the two foot arrangements');
            }
            assert.equal(m[0x46F + s] & 0x43, sign === 1 ? 0x40 : 0, 'left-facing artwork flips only when moving right, using palette zero');
            assert.equal(m[0x57E + s], 0, 'no idle timer on a floor');
            assert.equal(m[0x433 + s], 184);
            assert.equal(m[0x4FE + s], 15);
        }
        assert.equal(moved, 200);
        assert.deepEqual([...seen].sort(), [0x4E, 0x4F]);
            assert.equal(m[0xC0], 1, 'the player remains safe');
    }
});

realTest('walls turn the penguin around without a rest or penetration', () => {
    for (const options of [{wall: true}, {wall: true, facing: 64}]) {
        const n = start(options), m = n.cpu.mem, s = slot(m), directions = new Set();
        for (let i = 0; i < 1000; i++) {
            n.frame(); directions.add(m[0x556 + s]);
            assert.ok(pos(m, s) >= 64 && pos(m, s) <= 184, `x=${pos(m,s)}`);
            assert.equal(m[0x433 + s], 184);
            assert.equal(m[0x57E + s], 0);
        }
        assert.equal(directions.size, 2);
    }
});

const tileAt = (m, x, y) => (m[0x700 + y * 16 + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15;
const putTile = (m, x, y, value) => {
    const at = 0x700 + y * 16 + (x >> 1), shift = x & 1 ? 0 : 4;
    m[at] = (m[at] & ~(15 << shift)) | value << shift;
};
const smokeSprites = m => Array.from({length:64}, (_, i) => m.slice(0x200 + i*4, 0x204 + i*4))
    .filter(([y, tile]) => y < 240 && [0xA4, GraphicsCatalog.SCENE_GRAPHICS_LAYOUT.spawnSmoke].includes(tile));

realTest('gaps wait 120 active ticks, build visible ice, then extend a bridge one cell at a time', () => {
    for (const wide of [false, true]) for (const camera of [false, true]) for (const facing of [0, 64]) {
        const n = start({ledge: true, wide, camera, facing, playerAway:true}), m = n.cpu.mem, s = slot(m);
        for (let i = 0; i < 200 && m[0x57E+s] === 0; i++) n.frame();
        assert.equal(m[0x57E+s], 1);
        const edge = pos(m,s), direction = m[0x556+s], x = m[0x546+s], y = m[0x56E+s];
        const smokeTiles = new Set();
        assert.equal(tileAt(m,x,y), 0);
        for (let i = 1; i < Penguin.BUILD_TICKS - 1; i++) {
            n.frame(); assert.equal(pos(m,s), edge); assert.equal(tileAt(m,x,y), 0);
            assert.equal(m[0x556+s], direction);
            if (m[0x415+s]) assert.equal(m[0x415+s], Penguin.META);
            const smoke = smokeSprites(m);
            assert.equal(smoke.length, 2, 'building draws smoke without replacing the penguin');
            const left = (x * 16 - m[0xFD]) & 255;
            assert.deepEqual(smoke.map(sprite => sprite[3]).sort((a,b) => a-b), [left,left+8]);
            for (const sprite of smoke) {
                assert.equal(sprite[0], y * 16 + 7, 'smoke uses the native target-cell anchor');
                smokeTiles.add(sprite[1]);
            }
        }
        n.frame(); assert.equal(tileAt(m,x,y), Penguin.ICE_TILE); assert.equal(pos(m,s), edge);
        assert.equal(smokeSprites(m).length, 0, 'smoke ends on the ice commit tick');
        assert.equal(smokeTiles.size, 2, 'both original monster smoke poses animate');
        for (let i = 0; i < 4; i++) n.frame();
        assert.notEqual(pos(m,s), edge);
        const address = 0x2000 + (x >> 4) * 0x400 + y * 64 + (x & 15) * 2;
        const art = 2 + (Penguin.ICE_TILE - 4) * 4;
        assert.equal(n.ppu.vramMem[address], art, 'native ice top-left is drawn');
        assert.equal(n.ppu.vramMem[address + 1], art + 2);
        assert.equal(n.ppu.vramMem[address + 32], art + 1);
        if (camera && !wide) assert.equal(n.ppu.vramMem[address + 0x400], art, 'loop-view page mirror');
        for (let i = 0; i < 190; i++) n.frame();
        const next = (x + (direction >= 4 ? 1 : -1) + (wide ? 32 : 16)) % (wide ? 32 : 16);
        assert.equal(tileAt(m,next,y), Penguin.ICE_TILE);
        assert.equal(m[0x433+s], 184);
    }
});

realTest('players can land, ride continuously, jump off and pass through from below', () => {
    for (const wide of [false, true]) for (const facing of [0, 64]) {
        const n = start({wide, facing}), m = n.cpu.mem, s = slot(m);
        m[0xC2] = m[0x516+s]; m[0xC1] = m[0x50E+s];
        m[0x41E] = m[0x433+s] - 16; m[0x7D] = 0;
        m[0xC0] = 2; m[0x52] = 16; m[0xC7] = 1; m[0xC8] = m[0xC5] = m[0xC6] = 0;
        n.frame(); assert.equal(m[0x53E+s], 1); assert.equal(m[0xC0], 1);
        const distance = ((m[0xC1]*256+m[0xC2])-pos(m,s)+(wide?512:256))%(wide?512:256);
        for (let i = 0; i < 200; i++) {
            n.frame(); assert.equal(m[0x53E+s], 1); assert.equal(m[0x41E], m[0x433+s]-16);
            assert.equal(((m[0xC1]*256+m[0xC2])-pos(m,s)+(wide?512:256))%(wide?512:256), distance);
        }
        n.buttonDown(1, jsnes.Controller.BUTTON_A); n.frame(); n.buttonUp(1, jsnes.Controller.BUTTON_A);
        assert.equal(m[0x53E+s], 0); assert.equal(m[0xC0], 2);
        m[0xC2]=m[0x516+s];m[0xC1]=m[0x50E+s];m[0x41E]=m[0x433+s];m[0xC7]=0xFC;
        n.frame(); assert.equal(m[0x53E+s], 0, 'ascending from underneath does not attach');
    }
});

test('penguin and shared rider code fit their explicit reservations', () => {
    const rom = new Uint8Array(0x20010), passenger = BirdFish.addBirdFishPlatform(rom);
    const result = Penguin.install(rom, passenger);
    assert.ok(result.end <= Hud.ENTRY);
    assert.ok(result.lifeEnd <= 0x8C00);
    assert.ok(result.buildSmokeEnd <= 0x8100);
    assert.ok(Hud.install(rom, {showRemainingRescueCount:true}, result.buildSmoke).end <= 0x8A00);
});

function worker(n) {
    const c = n.cpu, m = c.mem;
    // Execute an active tick directly to control competing VRAM producers.
    n.mmap.write(0x8000, 6); m[0x5EE] = 6;
    m.splice(0x6000, 3, 0x20, Penguin.ENTRY & 255, Penguin.ENTRY >> 8);
    c.REG_PC = 0x5FFF; c.REG_SP = 0x1FF; c.irqRequested = false;
    for (let i = 0; i < 20000; i++) {
        c.emulate();
        if (c.REG_PC === 0x6002) {
            assert.equal(c.REG_SP, 0x1FF);
            assert.equal(m[0x5EE], 6, 'native calls retain the NMI guard');
            assert.equal(m[Penguin.ENTRY], 0xA2, 'native callback returns to bank 6');
            n.mmap.write(0x8000, 0); m[0x5EE] = 0; return;
        }
    }
    assert.fail('penguin worker did not return');
}

function drawBuildSmoke(n, available = 63) {
    const c = n.cpu, m = c.mem;
    m.fill(0xF4, 0x200, 0x300); m[4] = 0; m[7] = available;
    m.splice(0x6000, 3, 0x20, Hud.BRIDGE & 255, Hud.BRIDGE >> 8);
    c.REG_PC = 0x5FFF; c.REG_SP = 0x1FF; c.irqRequested = false;
    for (let i = 0; i < 20000; i++) {
        c.emulate();
        if (c.REG_PC === 0x6002) {
            assert.equal(c.REG_SP, 0x1FF);
            assert.equal(m[0x5EE], 0, 'OAM bridge restores the native bank guard');
            return smokeSprites(m);
        }
    }
    assert.fail('build smoke renderer did not return');
}

function prepareBuild(n) {
    const m = n.cpu.mem, s = slot(m);
    m[0x516+s] = 88; m[0x50E+s] = 0; m[0x433+s] = 184;
    m[0x556+s] = 4; m[0x57E+s] = 0;
    m[0xC2] = 32; m[0xC1] = 0; m[0x1E] = 0;
    putTile(m, 6, 12, 0);
    worker(n);
    assert.equal(drawBuildSmoke(n).length, 2);
    return s;
}

realTest('scene 6 builds Tile 6; every other supported scene builds Tile 5 with its native artwork and palette', () => {
    for (const [scene,expected] of [[0,5],[1,5],[2,5],[3,5],[4,5],[5,5],[6,6],[9,5],[10,5],[11,5]]) {
        const wide = !!(scene & 1);
        const n = start({scene,wide,camera:true,ledge:true,playerAway:true,floorTile:expected});
        const m = n.cpu.mem, s = slot(m);
        for (let frame = 0; frame < 400 && m[0x57E+s] < 119; frame++) n.frame();
        assert.equal(m[0x57E+s],119,`scene ${scene}: reaches construction`);
        const x = m[0x546+s], y = m[0x56E+s];
        assert.equal(tileAt(m,x,y),0);
        n.frame(); assert.equal(tileAt(m,x,y),expected,`scene ${scene}: collision tile`);
        assert.equal(smokeSprites(m).length,0);
        n.frame(); n.frame();
        const art = column => {
            const at = 0x2000 + (column >> 4)*0x400 + y*64 + (column & 15)*2;
            return [0,1,32,33].map(offset => n.ppu.vramMem[at+offset]);
        };
        const palette = column => {
            const at = 0x23C0 + (column >> 4)*0x400 + (y >> 1)*8 + ((column & 15) >> 1);
            return n.ppu.vramMem[at] >> (((y & 1)*2 + (column & 1))*2) & 3;
        };
        assert.deepEqual(art(x),art(8),`scene ${scene}: matches an editor-placed Tile ${expected}`);
        assert.equal(palette(x),palette(8),`scene ${scene}: native palette`);
    }
});

realTest('side contact turns away once in both directions, including map seams and wide pages', () => {
    for (const wide of [false,true]) for (const direction of [3,4]) {
        const n = start({wide}), m = n.cpu.mem, s = slot(m), width = wide ? 512 : 256;
        for (const x of [88,7,width-8,...(wide ? [248,264] : [])]) {
            const player = (x + (direction === 4 ? 12 : -12) + width) % width;
            m[0x516+s] = x & 255; m[0x50E+s] = x >> 8; m[0x433+s] = 184;
            m[0x556+s] = direction; m[0x53E+s] = 0;
            m[0xC2] = player & 255; m[0xC1] = player >> 8; m[0x41E] = 184;
            m[0x7D] = 0; m[0xC0] = 1; m[0xC7] = 0;
            for (let tick = 0; tick < 8; tick++) {
                worker(n);
                assert.equal(m[0x556+s],direction ^ 7,`${wide}, ${direction}, x=${x}: no contact oscillation`);
                assert.equal(m[0x46F+s] & 0x40,direction === 3 ? 0x40 : 0,'pose turns immediately');
                assert.equal(m[0xC0],1,'contact remains harmless');
            }
        }
    }
});

realTest('riders, vertically separated players and off-screen wide-page players do not steer a penguin', () => {
    const n = start({wide:true}), m = n.cpu.mem, s = slot(m);
    for (const [height,page,rider,high,state] of [[168,0,1,0,1],[168,0,0,0,1],[200,0,0,0,1],
        [184,1,0,0,1],[184,0,0,1,1],[184,0,0,0,3]]) {
        m[0x516+s] = 88; m[0x50E+s] = 0; m[0x433+s] = 184;
        m[0x556+s] = 4; m[0x53E+s] = rider;
        m[0xC2] = 100; m[0xC1] = page; m[0x41E] = height;
        m[0x7D] = high; m[0xC0] = state; m[0xC7] = 0;
        worker(n); assert.equal(m[0x556+s],4,JSON.stringify({height,page,rider,high,state}));
    }
});

realTest('steering interrupts construction and smoke, then starts a full wait in the new direction', () => {
    const n = start(), m = n.cpu.mem, s = prepareBuild(n);
    m[0x57E+s] = 119; m[0xC2] = 100; m[0x41E] = 184; m[0xC0] = 1; m[0x7D] = 0;
    worker(n);
    assert.equal(m[0x556+s],3); assert.equal(m[0x57E+s],0);
    assert.equal(tileAt(m,6,12),0); assert.equal(drawBuildSmoke(n).length,0);
    m[0xC2] = 220; m[0x516+s] = 71; putTile(m,3,12,0);
    worker(n); assert.equal(m[0x57E+s],1);
    assert.equal(drawBuildSmoke(n).length,2);
    for (let tick = 1; tick < 119; tick++) worker(n);
    assert.equal(tileAt(m,3,12),0,'old direction cannot donate its almost-complete progress');
    worker(n); assert.equal(tileAt(m,3,12),6); assert.equal(tileAt(m,6,12),0);
    assert.equal(drawBuildSmoke(n).length,0);
});

realTest('build smoke disappears immediately on interruption without changing defeat clocks', () => {
    for (const [name, interrupt] of [
        ['defeat', (m,s) => {m[0x506+s] = 10;}],
        ['thrown stone', m => {m[0x8B]=2; m[0x8E]=2; m[0x8C]=0; m[0x8D]=88; m[0x43B]=184;}],
        ['explosion', m => {m[0x4A8]=11; m[0x4AC]=0; m[0x4B0]=88; m[0x42B]=192;}],
        ['respawn wait', (m,s) => {m[0x506+s] = 13; m[0x57E+s] = 180;}],
        ['lost support', m => putTile(m,5,12,0)],
        ['blocked path', m => putTile(m,6,11,5)],
        ['occupied target', m => putTile(m,6,12,11)],
        ['unsupported scene', m => {m[0x3E] = 7;}],
        ['removed object', (m,s) => {m[0x4FE+s] = 0;}]
    ]) {
        const n = start(), m = n.cpu.mem, s = prepareBuild(n);
        interrupt(m,s); worker(n);
        const objects = m.slice(0x4FE,0x5E6);
        assert.equal(drawBuildSmoke(n).length, 0, name);
        assert.deepEqual(m.slice(0x4FE,0x5E6),objects,'rendering preserves all object clocks and states');
    }
});

realTest('blocked ice commits keep animating, and changing targets starts a fresh build', () => {
    const n = start(), m = n.cpu.mem, s = prepareBuild(n), poses = new Set();
    m[0x57E+s] = 119; m[0x1E] = 16;
    for (let i = 0; i < 50; i++) {
        worker(n);
        const smoke = drawBuildSmoke(n);
        assert.equal(smoke.length, 2); poses.add(smoke[0][1]);
        assert.equal(m[0x57E+s],120); assert.equal(tileAt(m,6,12),0);
    }
    assert.equal(poses.size,2,'animation does not freeze at the saturated construction timer');
    m[0x516+s] = 120; putTile(m,8,12,0); worker(n);
    assert.equal(m[0x57E+s],1,'progress belongs to one target cell');
    assert.deepEqual(drawBuildSmoke(n).map(s => s[3]).sort((a,b) => a-b),[128,136]);
    m[0x57E+s] = 119; m[0x1E] = 0; worker(n);
    assert.equal(tileAt(m,8,12),Penguin.ICE_TILE);
    assert.equal(drawBuildSmoke(n).length,0);
});

realTest('build smoke follows camera pages and clipping, preserves enemy slots and respects OAM capacity', () => {
    for (const wide of [false,true]) {
        const n = start({wide}), m = n.cpu.mem;
        prepareBuild(n);
        const objects = m.slice(0x4FE,0x5E6);
        for (const camera of [0,100,104,108,256,508]) {
            m[0xFD] = camera & 255; m[0x9D] = wide ? camera >> 8 : 0;
            const screen = (104 - (wide ? camera : camera & 255) + (wide ? 512 : 256)) % (wide ? 512 : 256);
            const smoke = drawBuildSmoke(n);
            assert.equal(smoke.length,screen >= 256 ? 0 : screen < 8 ? 1 : 2,`${wide}, camera ${camera}`);
            assert.deepEqual(m.slice(0x4FE,0x5E6),objects,'no enemy slot is allocated or moved for smoke');
        }
        m[0xFD] = m[0x9D] = 0;
        assert.equal(drawBuildSmoke(n,0).length,0,'one remaining OAM entry cannot fit two smoke columns');
    }
});

realTest('busy queues and falling tiles defer construction without timer overflow or invisible solids', () => {
    const n = start(), m = n.cpu.mem, s = slot(m);
    m[0x516+s] = 88; m[0x556+s] = 4; m[0x57E+s] = 119;
    m[0x546+s] = 6; m[0x56E+s] = 12;
    putTile(m,6,12,0); m[0x1E] = 16;
    const queue = m.slice(0x300,0x400);
    for (let i = 0; i < 300; i++) worker(n);
    assert.equal(tileAt(m,6,12), 0); assert.equal(m[0x57E+s], 120);
    assert.deepEqual(m.slice(0x300,0x400), queue);
    m[0x1E] = 0; m[0x4C0] = 1; m[0x4D4] = 12; m[0x4DE] = 24;
    worker(n); assert.equal(tileAt(m,6,12), 0, 'falling object owns the target');
    m[0x4C0] = 0; worker(n); assert.equal(tileAt(m,6,12), Penguin.ICE_TILE);
    assert.ok(m[0x1E] > 0, 'collision and background packet commit together');
});

realTest('construction respects players, collectibles, map seams and the bottom boundary', () => {
    for (const wide of [false, true]) for (const right of [false, true]) {
        const n = start({wide}), m = n.cpu.mem, s = slot(m), width = wide ? 32 : 16;
        const x = right ? 0 : width-1;
        m[0x516+s] = right ? 248 : 7; m[0x50E+s] = right && wide ? 1 : 0;
        m[0x556+s] = right ? 4 : 3; m[0x506+s] = 1; m[0x57E+s] = 119; m[0x1E] = 0;
        m[0x546+s] = x; m[0x56E+s] = 12;
        putTile(m,x,12,0);
        m[0xC2] = (x*16+8)&255; m[0xC1] = x>>4; m[0x41E] = 200;
        worker(n); assert.equal(tileAt(m,x,12),0, 'occupied target stays empty');
        m[0x41E]=24; worker(n); assert.equal(tileAt(m,x,12),Penguin.ICE_TILE,
            JSON.stringify({wide,right,x,position:pos(m,s),y:m[0x433+s],timer:m[0x57E+s],target:[m[0x546+s],m[0x56E+s]]}));
        putTile(m,x,12,11); m[0x1E]=0; worker(n);
        assert.equal(tileAt(m,x,12),11,'collectible is not overwritten');
        m[0x433+s]=216; m[0x516+s]=88;m[0x50E+s]=0;putTile(m,5,13,5);
        const tail=m.slice(0x7E0,0x800);worker(n);
        assert.deepEqual(m.slice(0x7E0,0x800),tail,'no map write below row 13');
    }
});

realTest('two penguins share a new bridge cell without duplicate writes and keep independent wait clocks', () => {
    const n=start(),m=n.cpu.mem,s=slot(m),other=s===7?6:7;
    for(const [i,x,d,timer] of [[s,88,4,119],[other,112,3,60]]) {
        m[0x4FE+i]=15;m[0x506+i]=1;m[0x433+i]=184;m[0x516+i]=x;m[0x50E+i]=0;
        m[0x556+i]=d;m[0x57E+i]=timer;m[0x53E+i]=0;
        m[0x546+i]=6;m[0x56E+i]=12;
    }
    putTile(m,6,12,0);m[0x1E]=0;
    worker(n);
    assert.equal(tileAt(m,6,12),Penguin.ICE_TILE);
    assert.equal(drawBuildSmoke(n).length,0,'both effects disappear when their shared cell is completed');
    assert.equal(m[0x1E],16,'only one native metatile packet');
    assert.equal(m[0x57E+s],120);
    assert.ok([0,61].includes(m[0x57E+other]),'another slot cannot inherit the completed timer');
    m[0x1E]=0;worker(n);
    assert.equal(m[0x57E+other],0,'the shorter wait ends when the path is already built');
    assert.equal(m[0x1E],0);
});

realTest('waiting freezes during pause, then finishes the remaining build delay', () => {
    const n = start({ledge:true}), m=n.cpu.mem,s=slot(m);
    for(let i=0;i<230 && m[0x57E+s]<30;i++) n.frame();
    assert.equal(m[0x57E+s],30);
    const smokeClock = m[Penguin.BUILD_SMOKE_CLOCK+s];
    n.buttonDown(1,jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1,jsnes.Controller.BUTTON_START);
    const timer=m[0x57E+s], map=m.slice(0x700,0x800), x=pos(m,s);
    for(let i=0;i<180;i++)n.frame();
    assert.equal(m[0x57E+s],timer);assert.equal(pos(m,s),x);assert.deepEqual(m.slice(0x700,0x800),map);
    assert.equal(m[Penguin.BUILD_SMOKE_CLOCK+s],smokeClock,'pause freezes smoke animation');
    n.buttonDown(1,jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1,jsnes.Controller.BUTTON_START);
    for(let i=0;i<150;i++)n.frame();
    assert.notDeepEqual(m.slice(0x700,0x800),map);
});

realTest('pause freezes pose, position and clock, then resumes the same walk', () => {
    const n = start(), m = n.cpu.mem, s = slot(m);
    for (let i = 0; i < 90; i++) n.frame();
    n.buttonDown(1, jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1, jsnes.Controller.BUTTON_START);
    const snapshot = () => [pos(m,s),m[0x433+s],m[0x566+s],m[0x415+s]];
    const paused = snapshot(); for (let i = 0; i < 40; i++) n.frame();assert.deepEqual(snapshot(), paused);
    n.buttonDown(1, jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1, jsnes.Controller.BUTTON_START);
    for (let i = 0; i < 90; i++) n.frame();assert.notDeepEqual(snapshot(), paused);
});

realTest('one switch removes the toolbar entry, ROM worker and previously placed type-15 objects', () => {
    try {
        Penguin.ENABLED = false;
        const editor = {enemyBtns: [], createButton: (type, container, name, id) => id};
        EditorToolbar.createEnemyButtons(editor);assert.equal(editor.enemyBtns.length, 14);
        const rom = stage();assert.ok(rom.slice(0x18610, 0x18010 + Hud.ENTRY - 0x8000).every(v => v === 0));
        const n = start();assert.equal(slot(n.cpu.mem), -1);
    } finally {Penguin.ENABLED = true;}
});

