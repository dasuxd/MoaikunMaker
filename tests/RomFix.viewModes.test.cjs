const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');

const root = path.join(__dirname, '..');
const source = ['Config', 'Level', 'RomFix', 'RomEditor', 'DataConverter']
    .map(name => fs.readFileSync(path.join(root, 'js', `${name}.js`), 'utf8'))
    .join('\n');
const { Config, Romfix, RomEditor, DataConverter } = new Function(
    'i18n', `${source}\nreturn {Config, Romfix, RomEditor, DataConverter};`
)({ t: key => key });

function machine(data) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    return nes;
}

function syntheticMachine() {
    const data = new Uint8Array(0x20010);
    data.set([0x4E, 0x45, 0x53, 0x1A, 8, 0, 0x21]);
    data.set([0x00, 0x80, 0x00, 0x80, 0x00, 0x80], 0x2000A);
    Romfix.fixWideScreenLoopingCamera(data, true);
    Romfix.addViewModes(data, true);
    // Native queue terminator writer, called at the very end of the NMI.
    data.set([0xA6, 0x1E, 0x9D, 0x00, 0x03, 0xE8, 0x86, 0x1E, 0x60],
        0x86B2 - 0x8000 + 16);
    const nes = machine(data); nes.cpu.mem[0xF4] = 0; return nes;
}

function call(nes, entry, carry = 1, stepLimit = 2000) {
    const cpu = nes.cpu;
    cpu.REG_SP = 0x1FF;
    cpu.REG_PC = 0x7FFF;
    cpu.irqRequested = false;
    cpu.F_CARRY = carry;
    cpu.mem[0x8000] = 0x20;
    cpu.mem[0x8001] = entry & 0xFF;
    cpu.mem[0x8002] = entry >> 8;
    for (let steps = 0; steps < stepLimit; steps++) {
        cpu.emulate();
        if (cpu.REG_PC === 0x8002) {
            assert.equal(cpu.REG_SP, 0x1FF, 'routine balances the stack');
            return;
        }
    }
    assert.fail(`routine $${entry.toString(16)} did not return`);
}

const target = (mem, hook) => mem[hook + 1] | (mem[hook + 2] << 8);

test('occupied reserved code space fails before installing runtime hooks', () => {
    const data = new Uint8Array(0x20010);
    data[0x1F110] = 0xCC;
    const before = data.slice();
    assert.throws(() => Romfix.addViewModes(data,true), /occupied/);
    assert.deepEqual(data,before);
    assert.throws(() => Romfix.addViewModes(data,false), /expanded ROM/);
});

test('runtime camera follows the selected view at every world X in both map widths', () => {
    const nes = syntheticMachine(), m = nes.cpu.mem;
    m[0x56] = 3;
    m[0x1F] = 0;
    for (const wide of [0, 1]) for (const view of [0, 1]) {
        m[0x3D] = wide;
        m[0x2A] = view;
        for (let x = 0; x < (wide ? 512 : 256); x++) {
            m[0xC1] = x >> 8;
            m[0xC2] = x & 255;
            m[0xFF] = 0xB1;
            call(nes, 0x9B38);
            const camera = view ? (x - 128) & (wide ? 511 : 255) : wide ? Math.max(0,Math.min(255,x-128)) : 0;
            assert.equal(m[0xFD] | (m[0x9D] << 8), camera, `width=${wide}, view=${view}, x=${x}`);
            assert.equal(m[0xFF], 0xB0 | (camera >> 8));
        }
    }
    m[0x2A] = 1;
    m[0x3D] = 1;
    m[0xC1] = 1;
    m[0xC2] = 255;
    m[0x1F] = 1;
    call(nes, 0x9B38);
    assert.equal(m[0xFD], 255, 'wide attract demo uses native bounded camera');
    assert.equal(m[0x9D], 0);
    m[0x3D] = 0;
    m[0xC1] = 0;
    call(nes, 0x9B38);
    assert.equal(m[0xFD] | m[0x9D] | (m[0xFF] & 1), 0,
        'narrow attract demo stays fixed even when LOOP is selected');
    for (const loadingState of [0, 1, 2]) {
        m[0x56] = loadingState;
        call(nes, 0x9B38);
        assert.equal(m[0xFD] | m[0x9D] | (m[0xFF] & 1), 0);
    }
});

test('all sprite projection families use the map width at both ring seams', () => {
    const nes = syntheticMachine(), cpu = nes.cpu, m = cpu.mem;
    const families = [
        { entry: 0x943C, low: 0xC2, high: 0xC1, screen: 0x43C, id: 0x400 },
        { entry: 0xA15B, low: 0x8D, high: 0x8C, screen: 0x459, id: 0x41D },
        { entry: 0xA2A3, low: 0x490, high: 0x484, screen: 0x43D, id: 0x401 },
        { entry: 0xA44E, low: 0x4B0, high: 0x4AC, screen: 0x449, id: 0x40D },
        { entry: 0xA780, low: 0x4F8, high: 0x4F5, screen: 0x44E, id: 0x412 },
        { entry: 0xAE54, low: 0x516, high: 0x50E, screen: 0x451, id: 0x415 },
        { entry: 0xD9F8, low: 0xDE, high: 0xDD, screen: 0x44E, id: 0x412 }
    ];
    m[0xC390] = 2;
    m[0xC377] = 2;
    m[0xC3B4] = 2;
    for (const wide of [0, 1]) {
        const mask = wide ? 511 : 255;
        m[0x3D] = wide;
        for (const camera of [0, 1, 127, 128, 254, 255, 256, 383, 511].filter(x => x <= mask)) {
            for (const world of [0, 1, 127, 128, 255, 256, 511].filter(x => x <= mask)) {
                for (const family of families) {
                    m[family.low] = world & 255;
                    m[family.high] = world >> 8;
                    m[0xFD] = camera & 255;
                    m[0x9D] = camera >> 8;
                    m[family.id] = 2;
                    m[0xD3] = 0;
                    m[0x4B8] = 0;
                    cpu.REG_X = 0;
                    call(nes, family.entry);
                    const distance = (world - camera) & mask;
                    assert.equal(m[family.screen], distance & 255);
                    assert.equal(m[family.id] !== 0, distance < 256,
                        `entry=${family.entry.toString(16)}, width=${wide}, camera=${camera}, world=${world}`);
                    if (family.entry === 0xA2A3) assert.equal(cpu.F_CARRY, distance >= 256 ? 1 : 0);
                }
                // The paired sub-sprites share this high-byte helper.
                m[0x01] = world >> 8;
                call(nes, 0x9B62, (world & 255) >= (camera & 255) ? 1 : 0);
                assert.equal(cpu.REG_ACC, ((world - camera) >> 8) & wide);
            }
        }
    }
});

test('attribute initialization and mutations repeat without duplicating map objects', () => {
    const nes = syntheticMachine(), cpu = nes.cpu, m = cpu.mem;
    for (const wide of [0, 1]) {
        m[0x3D] = wide;
        for (let row = 0; row < 14; row++) for (let byteX = 0; byteX < 16; byteX++) {
            cpu.REG_ACC = row * 16;
            m[0x00] = byteX;
            call(nes, target(m, 0x8ECE), 0);
            assert.equal(cpu.REG_X, row * 16 + (wide ? byteX : byteX & 7));
        }
        for (const hook of [0x90B0, 0xBBEA]) for (let index = 0; index < 128; index++) {
            m[0x680 + (index ^ 64)] = 0;
            cpu.REG_ACC = 0xE4;
            cpu.REG_X = 123;
            cpu.REG_Y = index;
            call(nes, target(m, hook), 0);
            assert.equal(m[0x680 + index], 0xE4);
            assert.equal(m[0x680 + (index ^ 64)], wide ? 0 : 0xE4);
            assert.equal(cpu.REG_ACC, 0xE4);
            assert.equal(cpu.REG_X, 123);
            assert.equal(cpu.REG_Y, index);
            assert.equal(cpu.F_CARRY, 0);
        }
    }
});

test('frame finalizer prepares both pages without accessing the PPU', () => {
    const nes = syntheticMachine(), cpu = nes.cpu, m = cpu.mem;
    m[0x2A] = 1;
    m[0x3D] = 0;
    m[0x18] = 4;
    m[0x30] = 12;
    const queue = [6, 0x23, 0xC0, 1, 0xE4, 0x21, 0x66, 2, 0x31, 0x32,
        0x21, 0x68, 2, 0x33, 0x34, 0xFF, 0];
    m.splice(0x300, queue.length, ...queue);
    m[0x1E] = 16;
    const writes = [];
    const write = nes.mmap.write.bind(nes.mmap);
    nes.mmap.write = (address, value) => {
        if (address >= 0x2000 && address <= 0x2007) writes.push(address);
        return write(address, value);
    };
    call(nes, target(m, 0x80C5));
    assert.deepEqual(m.slice(0x300, 0x310), queue.slice(0, 16));
    assert.deepEqual(m.slice(0x310, 0x321),
        [6, 0x27, 0xC0, 1, 0xE4, 0x25, 0x66, 2, 0x31, 0x32,
            0x25, 0x68, 2, 0x33, 0x34, 0xFF, 0]);
    assert.equal(m[0x1E], 33);
    assert.equal(cpu.REG_ACC, 0, 'NMI busy flag can be cleared after finalization');
    assert.deepEqual(writes, [], 'preparation writes RAM, not the PPU');
    assert.deepEqual(m.slice(0x886C, 0x8870), [0xE0, 6, 0xB0, 0x35]);
});

test('frame finalizer never mirrors palette, pattern, or mixed-address commands', () => {
    const commands = [
        [6, 0x3F, 0, 4, 0x31, 0x25, 0x20, 0x0F, 0xFF, 0],
        [6, 0x10, 0, 1, 0x31, 0xFF, 0],
        [6, 0x30, 0, 1, 0x31, 0xFF, 0],
        [7, 0x21, 0x66, 2, 0x31, 0x32, 0xFF, 0],
        [8, 0x21, 0x66, 2, 0x31, 0x32, 0xFF, 0],
        [6, 0x10, 0, 1, 0x31, 0x21, 0x66, 1, 0x32, 0xFF, 0],
        [6, 0x23, 0xC0, 1, 0xE4, 0x3F, 0, 4, 0x31, 0x25, 0x20, 0x0F, 0xFF, 0]
    ];
    for (const queue of commands) {
        const nes = syntheticMachine(), cpu = nes.cpu, m = cpu.mem;
        m[0x2A] = 1;
        m[0x3D] = 0;
        m[0x18] = 4;
        m[0x30] = 12;
        m.splice(0x300, queue.length, ...queue);
        m[0x1E] = queue.length - 1;
        call(nes, target(m, 0x80C5));
        assert.deepEqual(m.slice(0x300, 0x300 + queue.length), queue);
        assert.equal(m[0x1E], queue.length);
    }
});

test('frame finalizer handles fills and resets, bounds whole copies, and preserves palette RAM', () => {
    const packet = [6, 0x23, 0xC0, 1, 0xE4, 0x21, 0x66, 2, 0x31, 0x32,
        0x21, 0x68, 2, 0x33, 0x34, 0xFF];
    for (const count of [1, 8, 10, 13]) {
        const nes = syntheticMachine(), m = nes.cpu.mem;
        m[0x2A] = 1; m[0x3D] = 0; m[0x18] = 4; m[0x30] = 12;
        const prefix = [9, 3, 0x20, 0, 4, 0x50];
        const input = prefix.concat(...Array.from({ length: count }, () => packet));
        m.splice(0x300, input.length, ...input);
        m[0x1E] = input.length;
        const palette = Array.from({ length: 32 }, (_, i) => i + 0x50);
        m.splice(0x3E0, 32, ...palette);
        call(nes, target(m, 0x80C5), 1, 20000);
        const copies = Math.min(count, Math.floor((0xDF - input.length) / packet.length));
        assert.equal(m[0x1E], input.length + copies * packet.length + 1);
        assert.deepEqual(m.slice(0x300, 0x300 + input.length), input);
        assert.equal(m[0x300 + m[0x1E] - 1], 0);
        assert.deepEqual(m.slice(0x3E0, 0x400), palette);
        for (let i = 0; i < copies; i++) {
            const mirrored = packet.slice();
            for (const offset of [1, 5, 10]) mirrored[offset] ^= 4;
            assert.deepEqual(m.slice(0x300 + input.length + i * 16,
                0x300 + input.length + (i + 1) * 16), mirrored);
        }
    }
});

test('frame finalizer retains original queues outside live narrow gameplay', () => {
    for (const view of [0, 1]) for (const wide of [0, 1]) {
        for (const parent of [0, 4]) for (const state of [0, 7, 8, 11, 12, 13, 14, 255]) {
            const nes = syntheticMachine(), m = nes.cpu.mem;
            m[0x2A] = view; m[0x3D] = wide; m[0x18] = parent; m[0x30] = state;
            const packet = [6, 0x23, 0xC0, 1, 0xE4, 0xFF];
            m.splice(0x300, packet.length, ...packet);
            m[0x1E] = packet.length;
            call(nes, target(m, 0x80C5));
            const repeated = !wide && parent === 4 && state >= 8 && state <= 13;
            assert.equal(m[0x1E], repeated ? 13 : 7);
            assert.deepEqual(m.slice(0x300, 0x306), packet);
        }
    }
});

test('palette admission defers full uploads only on busy narrow frames', () => {
    const nes = syntheticMachine(), m = nes.cpu.mem;
    for (const view of [0, 1]) for (const wide of [0, 1]) {
        m[0x2A] = view; m[0x3D] = wide;
        for (let length = 0; length < 256; length++) {
            m[0x1E] = length;
            call(nes, target(m, 0x8B8E));
            assert.equal(nes.cpu.REG_ACC, length);
            assert.equal(nes.cpu.F_CARRY, Number(length >= (!wide ? 17 : 80)));
        }
    }
});

test('pause free-look is always available in wide maps and only LOOP in narrow maps', () => {
    const nes = syntheticMachine(), m = nes.cpu.mem;
    m[0x8B54] = 0x60;
    m[0x88D3] = 0x60;
    for (const wide of [0, 1]) for (const view of [0, 1]) {
        m[0x3D] = wide;
        m[0x2A] = view;
        m[0x32] = 1;
        m[0xFD] = 2;
        m[0x9D] = 0;
        m[0xF6] = 2;
        m[0xC1] = 0;
        m[0xC2] = 38;
        call(nes, 0x8B4F);
        assert.equal(m[0xFD] | (m[0x9D] << 8), wide || view ? (wide ? 510 : 254) : 2);
        if (wide || view) {
            assert.equal(m[0x43C], 40);
            assert.equal(m[0x400], 2);
            m[0xF6] = 1;
            call(nes, 0x8B4F);
            assert.equal(m[0xFD] | (m[0x9D] << 8), 2);
            assert.equal(m[0x43C], 36);
            m[0x32] = 0;
            call(nes, 0x8B4F);
            assert.equal(m[0x32], 1, 'return begins while still paused');
            for(let i=0;i<140&&m[0x32];i++)call(nes,0x8B4F);
            assert.equal(m[0x32], 0, 'arrival resumes without another START press');
            assert.equal(m[0x6E], 1);
            call(nes, 0x8B4F);
            assert.equal(m[0xFE] & 0x10, 0x10);
        }
    }
});

test('native background queue checks preserve registers and reduce narrow mirrored capacity', () => {
    const nes = syntheticMachine(), cpu = nes.cpu, m = cpu.mem;
    for (const wide of [0, 1]) for (const view of [0, 1]) {
        m[0x3D] = wide;
        m[0x2A] = view;
        const limit = !wide ? 16 : 32;
        for (const hook of [0xA507, 0xA868]) for (let length = 0; length < 256; length++) {
            m[0x1E] = length;
            cpu.REG_X = 0x5A;
            cpu.REG_Y = 0xA5;
            call(nes, target(m, hook));
            assert.equal(cpu.REG_ACC, length);
            assert.equal(cpu.F_CARRY, Number(length >= limit));
            assert.equal(cpu.REG_X, 0x5A);
            assert.equal(cpu.REG_Y, 0xA5);
        }
    }
});

// Optional full-ROM regressions. Never commit the user-supplied ROM or embed
// its bytes in fixtures. Set MOAIKUN_TEST_ROM to an original ROM's local path.
const romPath = process.env.MOAIKUN_TEST_ROM;
const original = romPath ? fs.readFileSync(romPath) : null;
const realTest = (name, body) => test(name, { skip: !original }, body);

function exportStage(expanded, wide, scene = 0, rock = false, doorX = 11, cameraFollow = true, spawnX = null) {
    const editor = new RomEditor();
    editor.loadROM(original);
    editor.gameConfig.cameraFollow = cameraFollow;
    if (expanded) editor.romType = Config.ROM_TYPE_EXPANDED;
    editor.gameConfig.disableTimer = true;
    const width = wide ? 32 : 16;
    const map = Array.from({ length: 14 }, () => Array(width).fill(0));
    map[12].fill(5);
    // Keep a rescue off the walking path so crossing the door cannot finish
    // the stage during the long camera regression.
    map[1][3] = 15;
    if (rock) map[11][rock === 'right' ? width - 1 : 0] = 10;
    const converted = DataConverter.fromLevelEditorToROMData({
        background: scene | (wide ? 0x10 : 0),
        player: { x: spawnX ?? (rock === 'right' ? width - 2 : rock ? 1 : 8), y: 11 },
        door: { x: doorX, y: 10 }, map, enemies: []
    }, wide);
    editor.levels[0].data = converted.mapData;
    editor.levels[0].monsterData = converted.monsterData;
    editor.levelCount = 1;
    return editor.getROMData();
}

function exportRescueStage(expanded, wide) {
    const editor = new RomEditor();
    editor.loadROM(original);
    editor.gameConfig.cameraFollow = true;
    if (expanded) editor.romType = Config.ROM_TYPE_EXPANDED;
    editor.gameConfig.disableTimer = true;
    const map = Array.from({ length: 14 }, () => Array(wide ? 32 : 16).fill(0));
    // A run of sixteen tile-$F cells encodes as $FF, the ROM terminator.
    // Use eight per row so the fixture is representable in native RLE.
    for (let y = 1; y <= 8; y++) map[y].fill(15, 0, 8);
    map[12].fill(5);
    const converted = DataConverter.fromLevelEditorToROMData({
        background: 3 | (wide ? 0x10 : 0),
        player: { x: 8, y: 11 }, door: { x: 11, y: 10 }, map, enemies: []
    }, wide);
    editor.levels[0].data = converted.mapData;
    editor.levels[0].monsterData = converted.monsterData;
    editor.levelCount = 1;
    return editor.getROMData();
}

function exportFallingStage(expanded, wide, scene, tile, count) {
    const editor = new RomEditor();
    editor.loadROM(original);
    editor.gameConfig.cameraFollow = true;
    if (expanded) editor.romType = Config.ROM_TYPE_EXPANDED;
    editor.gameConfig.disableTimer = true;
    const map = Array.from({ length: 14 }, () => Array(wide ? 32 : 16).fill(0));
    for (let y = 1; y <= 8; y++) map[y].fill(15, 0, 4);
    for (let i = 0; i < count; i++) map[4][6 + i] = tile;
    map[12].fill(5);
    const converted = DataConverter.fromLevelEditorToROMData({
        background: scene | (wide ? 0x10 : 0),
        player: { x: 0, y: 11 }, door: { x: 11, y: 10 }, map, enemies: []
    }, wide);
    editor.levels[0].data = converted.mapData;
    editor.levels[0].monsterData = converted.monsterData;
    editor.levelCount = 1;
    return editor.getROMData();
}

function start(data, view) {
    const nes = machine(data);
    for(let f=0;f<160;f++) nes.frame();
    nes.buttonDown(1,jsnes.Controller.BUTTON_START); nes.frame();
    nes.buttonUp(1,jsnes.Controller.BUTTON_START);
    for(let f=0;f<500;f++) {
        nes.frame();
        if(nes.cpu.mem[0x30]===12 && nes.cpu.mem[0x56]===3) {
            nes.frame();
            if(view) {
                nes.buttonDown(1,jsnes.Controller.BUTTON_UP); nes.frame();
                nes.buttonUp(1,jsnes.Controller.BUTTON_UP);
                for(let i=0;i<80;i++) nes.frame();
            }
            for(let i=0;i<140&&(nes.cpu.mem[0x2A]&128);i++)nes.frame();
            return nes;
        }
    }
    assert.fail('START did not reach live gameplay');
}

const worldX = m => (m[0xC1] << 8) | m[0xC2];
const cameraX = m => (m[0x9D] << 8) | m[0xFD];

realTest('a far-right wide spawn enters gameplay with a smooth camera instead of teleporting', () => {
    // Native player-start coordinates encode only the first 16 columns.
    const nes = machine(exportStage(true,true,0,false,11,true,15)),m=nes.cpu.mem;
    for(let i=0;i<160;i++)nes.frame();
    nes.buttonDown(1,jsnes.Controller.BUTTON_START);nes.frame();
    nes.buttonUp(1,jsnes.Controller.BUTTON_START);
    let changes=0,live=false,settled=false,previous=cameraX(m);
    for(let i=0;i<500;i++) {
        nes.frame();
        const camera=cameraX(m);
        if(m[0x30]===12&&m[0x56]===3) {
            live=true;
            let delta=(camera-previous)&511;if(delta>255)delta-=512;
            assert.ok(Math.abs(delta)<=4,'initial gameplay frame must not jump to the player');
            if(delta)changes++;
            const target=Math.max(0,Math.min(255,worldX(m)-128));
            if(!(m[0x2A]&128)&&camera===target){settled=true;break;}
        }
        previous=camera;
    }
    assert.ok(live&&settled);assert.ok(changes>1,'the entry scroll takes several frames');
    assert.equal(m[0x2A],0);assert.equal(nes.cpu.REG_SP,0x1FF);
});

realTest('pause stays active until the camera has reached the selected gameplay view', () => {
    for(const wide of [false,true])for(const view of [0,1]) {
        if(!wide&&!view)continue;
        const nes=start(exportStage(true,wide),view),m=nes.cpu.mem,mask=wide?511:255;
        for(let i=0;i<80;i++)nes.frame();
        const player=worldX(m),vertical=m[0xFC];
        nes.buttonDown(1,jsnes.Controller.BUTTON_START);nes.frame();
        nes.buttonUp(1,jsnes.Controller.BUTTON_START);nes.frame();
        assert.equal(m[0x32],1);
        nes.buttonDown(1,jsnes.Controller.BUTTON_RIGHT);
        for(let i=0;i<27;i++)nes.frame();
        nes.buttonUp(1,jsnes.Controller.BUTTON_RIGHT);nes.frame();
        assert.equal(worldX(m),player);
        const paused=cameraX(m);let previous=paused,changes=0,settled=false,activeUpdates=0;
        const emulate=nes.cpu.emulate.bind(nes.cpu);
        nes.cpu.emulate=()=>{if(nes.cpu.REG_PC===0x8B53)activeUpdates++;return emulate();};
        const world=m.slice(0x480,0x600),map=m.slice(0x700,0x800),timer=m.slice(0x70,0x76);
        const target=view?(player-128)&mask:Math.max(0,Math.min(255,player-128));
        assert.notEqual(paused,target);
        nes.buttonDown(1,jsnes.Controller.BUTTON_START);
        for(let i=0;i<140;i++) {
            nes.frame();if(i===0)nes.buttonUp(1,jsnes.Controller.BUTTON_START);
            const camera=cameraX(m);let delta=(camera-previous)&mask;if(delta>(mask>>1))delta-=mask+1;
            assert.ok(Math.abs(delta)<=4,'resume must not teleport from free-look');
            if(delta)changes++;
            assert.equal(m[0xFC],vertical);assert.equal(worldX(m),player);
            if(previous!==target) {
                assert.equal(m[0x32],1,'keep native pause active, including the arrival frame');
                assert.equal(activeUpdates,0,'player/enemy/falling/timer updates cannot run during return');
                assert.deepEqual(m.slice(0x480,0x600),world);
                assert.deepEqual(m.slice(0x700,0x800),map);
                assert.deepEqual(m.slice(0x70,0x76),timer);
            }
            previous=camera;
            if(m[0x32]===0&&!(m[0x2A]&128)&&camera===target){settled=true;break;}
        }
        assert.ok(settled);assert.ok(changes>1);assert.equal(m[0x2A],view);
        assert.ok(activeUpdates>0,'gameplay resumes automatically after arrival');
        nes.frame();assert.equal(m[0x6E],1);assert.equal(m[0xFE]&0x10,0x10);
        assert.equal(nes.cpu.REG_SP,0x1FF);
    }
});

realTest('held directions and repeated START cannot interrupt or redirect the paused return', () => {
    for(const wide of [false,true])for(const view of [0,1]) {
        if(!wide&&!view)continue;
        const nes=start(exportStage(true,wide),view),m=nes.cpu.mem,mask=wide?511:255;
        const player=worldX(m);
        nes.buttonDown(1,jsnes.Controller.BUTTON_START);nes.frame();
        nes.buttonUp(1,jsnes.Controller.BUTTON_START);nes.frame();
        nes.buttonDown(1,jsnes.Controller.BUTTON_RIGHT);
        for(let i=0;i<20;i++)nes.frame();
        nes.buttonUp(1,jsnes.Controller.BUTTON_RIGHT);nes.frame();
        const target=view?(player-128)&mask:Math.max(0,Math.min(255,player-128));
        let previous=cameraX(m),resumed=false;
        nes.buttonDown(1,jsnes.Controller.BUTTON_START);
        nes.buttonDown(1,jsnes.Controller.BUTTON_RIGHT);
        nes.buttonDown(1,jsnes.Controller.BUTTON_UP);
        for(let i=0;i<100;i++) {
            if(i===1)nes.buttonUp(1,jsnes.Controller.BUTTON_START);
            if(i===3)nes.buttonDown(1,jsnes.Controller.BUTTON_START);
            if(i===4) {
                nes.buttonUp(1,jsnes.Controller.BUTTON_START);
                nes.buttonUp(1,jsnes.Controller.BUTTON_UP);
            }
            nes.frame();
            assert.equal(m[0x2A]&1,view,'UP cannot change the target during return');
            if(m[0x32]===0) {
                assert.equal(previous,target,'the target was reached before gameplay resumed');
                assert.notEqual(worldX(m),player,'held movement becomes available after arrival');
                resumed=true;break;
            }
            assert.equal(worldX(m),player,'held RIGHT must not move the player during return');
            let delta=(cameraX(m)-previous)&mask;if(delta>(mask>>1))delta-=mask+1;
            assert.ok(Math.abs(delta)<=4);previous=cameraX(m);
        }
        nes.buttonUp(1,jsnes.Controller.BUTTON_RIGHT);
        assert.ok(resumed);assert.equal(nes.cpu.REG_SP,0x1FF);
    }
});

realTest('both feature settings retain native START and working password entry', () => {
    for (const expanded of [true]) for(const enabled of [false,true]) {
        const editor = new RomEditor();
        editor.loadROM(original);
        editor.gameConfig.cameraFollow = enabled;
        if (expanded) editor.romType = Config.ROM_TYPE_EXPANDED;
        const data = editor.getROMData(), gameplay = start(data, 0);
        assert.equal(gameplay.cpu.mem[0x2A], 0);
        assert.equal(cameraX(gameplay.cpu.mem), 0, 'native narrow level starts with a fixed camera');
        const password = machine(data);
        for (let f = 0; f < 160; f++) password.frame();
        password.buttonDown(1, jsnes.Controller.BUTTON_SELECT);
        password.frame();
        password.buttonUp(1, jsnes.Controller.BUTTON_SELECT);
        password.frame();
        password.buttonDown(1, jsnes.Controller.BUTTON_START);
        password.frame();
        password.buttonUp(1, jsnes.Controller.BUTTON_START);
        for (let f = 0; f < 140; f++) password.frame();
        assert.equal(password.cpu.mem[0x18], 2, 'second choice remains on the original title/password path');
        assert.equal(password.cpu.mem[0x50], 1, 'native password handler is accepting input');
        password.buttonDown(1, jsnes.Controller.BUTTON_RIGHT);
        password.frame();
        password.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
        password.frame();
        assert.equal(password.cpu.mem[0x51], 1, 'password cursor responds to input');
        assert.equal(password.cpu.REG_SP, 0x1FF);
    }
});

realTest('disabled single-screen modes keep narrow camera fixed and wide camera looping at every world X', () => {
    for (const expanded of [true]) for (const wide of [false, true]) {
        const nes = machine(exportStage(expanded, wide, 0, false, 11, false)), m = nes.cpu.mem;
        m[0x56] = 3;
        m[0x3D] = Number(wide);
        // The legacy title selection also selects password input. It must
        // never become a gameplay view flag when optional modes are disabled.
        for (const selection of [0, 1]) for (let x = 0; x < (wide ? 512 : 256); x++) {
            m[0x2A] = selection;
            m[0xC1] = x >> 8;
            m[0xC2] = x & 255;
            m[0xFF] = 0xB1;
            call(nes, 0x9B38);
            const expected = wide ? (x - 128) & 511 : 0;
            assert.equal(cameraX(m), expected,
                `disabled modes: expanded=${expanded} wide=${wide} selection=${selection} x=${x}`);
            assert.equal(m[0xFF], 0xB0 | (expected >> 8));
        }
    }
});

realTest('disabled single-screen modes retain wide pause free-look in both directions and normal resume', () => {
    for (const expanded of [true]) for (const wide of [false, true]) {
        const nes = start(exportStage(expanded, wide, 0, false, 11, false), 0), m = nes.cpu.mem;
        const initialWorld = worldX(m);
        nes.buttonDown(1, jsnes.Controller.BUTTON_START);
        nes.frame();
        nes.buttonUp(1, jsnes.Controller.BUTTON_START);
        nes.frame();
        assert.equal(m[0x32], 1, 'native start button pauses gameplay');
        const initialCamera = cameraX(m), mask = wide ? 511 : 255;
        for (const [button, delta] of [[jsnes.Controller.BUTTON_RIGHT, 4],
            [jsnes.Controller.BUTTON_LEFT, -4]]) {
            let expected = cameraX(m);
            nes.buttonDown(1, button);
            for (let frame = 0; frame < 140; frame++) {
                nes.frame();
                if (wide) expected = (expected + delta) & mask;
                assert.equal(cameraX(m), expected, 'wide free-look crosses the seam without moving the player');
                assert.equal(worldX(m), initialWorld);
                assert.equal(m[0x32], 1);
            }
            nes.buttonUp(1, button);
            nes.frame();
            assert.equal(cameraX(m), expected, 'paused camera holds its position without direction input');
        }
        assert.equal(cameraX(m), initialCamera, 'opposite directions restore the original paused view');
        nes.buttonDown(1, jsnes.Controller.BUTTON_START);
        nes.frame();
        nes.buttonUp(1, jsnes.Controller.BUTTON_START);
        nes.frame();
        nes.frame();
        assert.equal(m[0x32], 0, 'native start button resumes gameplay');
        assert.equal(cameraX(m), wide ? (worldX(m) - 128) & 511 : 0);
        if (wide) assert.equal(m[0x6E], 1, 'resume restores extra sprite groups');
        assert.equal(nes.cpu.REG_SP, 0x1FF);
    }
});

realTest('native bat flight wraps both horizontal edges and retains vertical removal', () => {
    for (const expanded of [true]) for (const cameraFollow of [true]) {
        const nes = machine(exportStage(expanded, false, 0, false, 11, cameraFollow)), m = nes.cpu.mem;
        for (const wide of [0, 1]) for (const view of [0, 1]) {
            m[0x3D] = wide;
            m[0x2A] = view;
            const mask = wide ? 511 : 255;
            const prepare = (x, y, dx, dy) => {
                nes.cpu.REG_X = 0;
                m[0x4FE] = 5; m[0x506] = 1;
                m[0x50E] = x >> 8; m[0x516] = x & 255;
                m[0x433] = y;
                m[0x51E] = 0; m[0x526] = 0;
                m[0x536] = 0; m[0x52E] = dx & 255;
                m[0x546] = 0; m[0x53E] = dy & 255;
            };
            for (let x = 0; x <= mask; x++) for (const dx of [-3, 3]) {
                prepare(x, 120, dx, -1);
                call(nes, 0xAC71);
                assert.equal(m[0x4FE], 5, 'horizontal edge never removes the bat');
                assert.equal((m[0x50E] << 8) | m[0x516], (x + dx) & mask);
                assert.equal(m[0x433], 119, 'native diagonal flight remains intact');
            }
            for (const x of [0, mask >> 1, mask]) {
                for (const y of [0, 1, 2, 3, 0xD9, 0xDA, 0xFE, 0xFF]) {
                    prepare(x, y, 3, -1);
                    call(nes, 0xAC71);
                    assert.equal(m[0x4FE], 0, 'native upper/lower limits still remove the bat');
                    assert.equal(m[0x415], 0);
                }
                for (const y of [4, 0xD8]) {
                    prepare(x, y, 3, 0);
                    call(nes, 0xAC71);
                    assert.equal(m[0x4FE], 5, 'last valid vertical positions remain valid');
                }
            }
            // The full shared checker still rejects horizontal edges for its
            // other callers; the knife's entry still uses movement directly.
            prepare(0, 120, 3, 0);
            call(nes, 0xAC48);
            assert.equal(nes.cpu.F_CARRY, 1);
            prepare(mask, 120, 3, 0);
            m[0x4FE] = 11;
            call(nes, 0xAC76);
            assert.equal(m[0x4FE], 11);
            assert.equal((m[0x50E] << 8) | m[0x516], (mask + 3) & mask);
        }
        const begin = 0xAC48 - 0x8000 + 16, end = 0xAC7F - 0x8000 + 16;
        const expected = new Uint8Array(original.subarray(begin, end));
        expected[0xAC72 - 0xAC48] = 0x5C;
        const data = exportStage(expanded, false, 0, false, 11, cameraFollow);
        assert.deepEqual(data.slice(begin, end), expected, 'only one operand byte changes in native flight code');
    }
});

realTest('enemy 3/8 bat volleys leave vertically and release slots for the next native volley', () => {
    for (const expanded of [true]) for (const cameraFollow of [true]) {
        const nes = machine(exportStage(expanded, false, 0, false, 11, cameraFollow)), m = nes.cpu.mem;
        for (const wide of [0, 1]) for (const shooter of [3, 8]) for (const facing of [3, 4]) {
            m.fill(0, 0x4FE, 0x586);
            m[0x3D] = wide;
            m[0x4FE + 7] = shooter;
            m[0x506 + 7] = 3; m[0x57E + 7] = 1;
            m[0x556 + 7] = facing;
            m[0x516 + 7] = facing === 3 ? 6 : 250;
            m[0x433 + 7] = 100;
            nes.cpu.REG_X = 7;
            call(nes, 0xAB58);
            const slots = [3, 4, 5, 6], mask = wide ? 511 : 255;
            for (const slot of slots) {
                assert.equal(m[0x4FE + slot], 5, 'native shooter produces four bats');
                assert.notEqual(m[0x546 + slot] | m[0x53E + slot], 0,
                    'every native bat trajectory has vertical velocity');
                // Start the actual volley at a horizontal seam, retaining
                // each projectile's native velocity and fractional state.
                const x = facing === 3 ? 0 : mask;
                m[0x516 + slot] = x & 255; m[0x50E + slot] = x >> 8;
                nes.cpu.REG_X = slot;
                call(nes, 0xAC71);
                assert.equal(m[0x4FE + slot], 5);
                const crossedX = (m[0x50E + slot] << 8) | m[0x516 + slot];
                assert.ok(facing === 3 ? crossedX > mask - 8 : crossedX < 8,
                    'freshly emitted bat crosses the seam using native velocity');
            }
            for (let frame = 0; frame < 600; frame++) for (const slot of slots) {
                if (!m[0x4FE + slot]) continue;
                const y = m[0x433 + slot], inside = y >= 4 && y < 0xD9;
                nes.cpu.REG_X = slot;
                call(nes, 0xAC71);
                assert.equal(m[0x4FE + slot], inside ? 5 : 0,
                    'flight remains active until reaching the original vertical boundary');
            }
            for (const slot of slots) assert.equal(m[0x4FE + slot], 0, 'all bat slots eventually become free');
            m[0x506 + 7] = 3; m[0x57E + 7] = 1;
            nes.cpu.REG_X = 7;
            call(nes, 0xAB58);
            for (const slot of slots) assert.equal(m[0x4FE + slot], 5, 'next volley reuses the free slots');
        }
    }
});

realTest('exit opens and closes both LOOP pages in every region without late PPU writes', () => {
    for (const expanded of [true]) for (const wide of [false, true]) {
        for (const view of [0, 1]) for (const scene of [3, 8]) {
            for (const doorX of wide ? [2, 28] : [2, 14]) {
                const nes = start(exportStage(expanded, wide, scene, false, doorX), view);
                const m = nes.cpu.mem, phases = [];
                // A checkpoint after the final rescue: let the original exit
                // collision and complete automatic door sequence run normally.
                // No drawing routine, stage state, or animation phase is forced.
                m[0x43] = 0;
                const x = m[0x89] * 16 + 1;
                m[0xC1] = x >> 8;
                m[0xC2] = x & 255;
                let frame = 0, maxScrollLine = 0, paletteWrites = 0;
                const verticalScroll = m[0xFC], write = nes.mmap.write.bind(nes.mmap);
                nes.mmap.write = (address, value) => {
                    if (address === 0x2007 || address === 0x2005) {
                        assert.ok(nes.ppu.scanline < 20,
                            `exit: expanded=${expanded} wide=${wide} view=${view} scene=${scene} door=${doorX} frame=${frame} line=${nes.ppu.scanline}`);
                        if (address === 0x2005) maxScrollLine = Math.max(maxScrollLine, nes.ppu.scanline);
                        if (address === 0x2007 && (nes.ppu.vramAddress & 0x3FFF) >= 0x3F00) paletteWrites++;
                    }
                    return write(address, value);
                };
                for (frame = 0; frame < 300; frame++) {
                    nes.frame();
                    if (m[0x30] !== 13) break;
                    if (phases.at(-1) !== m[0x62]) phases.push(m[0x62]);
                    assert.equal(m[0xFC], verticalScroll);
                    if (!wide) {
                        assert.deepEqual(nes.ppu.vramMem.slice(0x2000, 0x23F8),
                            nes.ppu.vramMem.slice(0x2400, 0x27F8),
                            'opening, fully open and closing exit stay identical on both pages');
                    }
                }
                assert.deepEqual(phases, [1, 2, 3, 2, 1], 'complete native opening/closing animation');
                assert.equal(m[0x30], 15, 'native exit reaches stage-completion fade');
                assert.ok(maxScrollLine > 0);
                assert.ok(paletteWrites > 32, 'palette updates continue during animation waits');
            }
        }
    }
});

realTest('falling half-steps with rescues and scene animation restore scroll before pre-render', () => {
    for (const expanded of [true]) for (const wide of [false, true]) {
        for (const view of [0, 1]) for (const scene of [3, 8]) {
            for (const [tile, count] of [[7, 10], [13, 1]]) {
                const nes = start(exportFallingStage(expanded, wide, scene, tile, count), view);
                const m = nes.cpu.mem;
                // Reproduce a checkpoint immediately after support removal.
                // Only initialize native falling slots; all motion, old-cell
                // restoration, collision and queue production use NES code.
                for (let i = 0; i < count; i++) {
                    m[0x4C0 + i] = 1;
                    m[0x4CA + i] = tile;
                    m[0x4D4 + i] = (6 + i) * 2;
                    m[0x4DE + i] = 8;
                    m[0x4E8 + i] = 0;
                }
                let frame = 0, paletteWrites = 0, maxScrollLine = 0;
                const verticalScroll = m[0xFC], writes = nes.mmap.write.bind(nes.mmap);
                const positions = new Set();
                nes.mmap.write = (address, value) => {
                    if (address === 0x2007 || address === 0x2005) {
                        assert.ok(nes.ppu.scanline < 20,
                            `fall transfer: expanded=${expanded} wide=${wide} view=${view} scene=${scene} tile=${tile} count=${count} frame=${frame} line=${nes.ppu.scanline} pc=${(nes.cpu.REG_PC + 1).toString(16)}`);
                        if (address === 0x2005) maxScrollLine = Math.max(maxScrollLine, nes.ppu.scanline);
                        if (address === 0x2007 && (nes.ppu.vramAddress & 0x3FFF) >= 0x3F00) paletteWrites++;
                    }
                    return writes(address, value);
                };
                for (frame = 0; frame < 240; frame++) {
                    nes.frame();
                    assert.equal(m[0x30], 12, 'falling checkpoint remains in gameplay');
                    assert.equal(m[0xFC], verticalScroll, 'camera never intentionally moves vertically');
                    positions.add(m[0x4DE]);
                    if (!wide) {
                        assert.deepEqual(nes.ppu.vramMem.slice(0x2000, 0x23F8),
                            nes.ppu.vramMem.slice(0x2400, 0x27F8),
                            'both pages receive the complete falling update in the same frame');
                    }
                }
                assert.ok(positions.size > 4, 'exercise successive odd and even half-tile steps');
                for (let i = 0; i < count; i++) assert.ok(m[0x4DE + i] >= 12, 'later slots also make progress');
                assert.ok(maxScrollLine > 0);
                if (scene === 3) assert.ok(paletteWrites >= 32, 'deferred full palettes eventually upload');
                assert.equal(nes.cpu.REG_SP, 0x1FF);
            }
        }
    }
});

realTest('64 rescues use native scan continuation, animate every head, and restore scroll during vblank', () => {
    for (const expanded of [true]) for (const wide of [false, true]) for (const view of [0, 1]) {
        const nes = start(exportRescueStage(expanded, wide), view), m = nes.cpu.mem;
        let maximumUpdates = 0, scrollRestores = 0, frame = 0;
        const visited = new Set(), phases = new Set();
        const step = nes.cpu.emulate.bind(nes.cpu);
        nes.cpu.emulate = () => {
            if (nes.cpu.REG_PC + 1 === 0x8846) {
                let y = 0, updates = 0;
                while (m[0x300 + y]) {
                    const command = m[0x300 + y++];
                    if (command === 9) continue;
                    assert.equal(command, 6, 'stage 1 uses counted drawing commands');
                    if (m[0x300 + y] >= 0x20 && m[0x300 + y] < 0x30) {
                        if (m[0x300 + y] < 0x24) {
                            updates++;
                            visited.add((m[0x300 + y + 4] << 8) | m[0x300 + y + 5]);
                        }
                    }
                    do {
                        y += 2;
                        y += 1 + m[0x300 + y];
                    } while (m[0x300 + y] < 0x80);
                    y++;
                }
                maximumUpdates = Math.max(maximumUpdates, updates);
            }
            return step();
        };
        const write = nes.mmap.write.bind(nes.mmap);
        nes.mmap.write = (address, value) => {
            if (address === 0x2007 || address === 0x2005 ||
                address === 0x2000 && nes.cpu.REG_PC + 1 === 0x8111) {
                assert.ok(nes.ppu.scanline < 20,
                    `PPU updates finish before pre-render: expanded=${expanded} wide=${wide} view=${view} frame=${frame} address=${address.toString(16)} pc=${(nes.cpu.REG_PC + 1).toString(16)} scanline=${nes.ppu.scanline} queue=${m[0x1E]} state=${m[0x30]}`);
                if (address === 0x2005) scrollRestores++;
            }
            return write(address, value);
        };
        for (let f = 0; f < 420; f++) {
            frame = f;
            nes.frame();
            assert.equal(m[0x30], 12, `stress fixture gameplay: expanded=${expanded} wide=${wide} view=${view} frame=${frame} playerY=${m[0x41E]}`);
            phases.add(m[0x6A]);
        }
        assert.equal(maximumUpdates, !wide ? 1 : 2);
        const expected = [];
        for (let y = 1; y <= 8; y++) for (let x = 0; x < 8; x++) {
            expected.push(0x2000 + y * 64 + x * 2);
        }
        assert.deepEqual([...visited].sort((a, b) => a - b), expected,
            'the deferred scanner reaches every rescue instead of starving later cells');
        assert.equal(phases.size, 4, 'the crying animation continues through all four native phases');
        assert.ok(scrollRestores > 0);
        assert.equal(nes.cpu.REG_SP, 0x1FF);
    }
});

realTest('full original palette uploads are restored and honor palette inhibition', () => {
    for (const expanded of [true]) {
        const editor = new RomEditor();
        editor.loadROM(original);
        editor.gameConfig.cameraFollow = true;
        if (expanded) editor.romType = Config.ROM_TYPE_EXPANDED;
        const nes = machine(editor.getROMData()), m = nes.cpu.mem;
        assert.equal(target(m, 0x8B94), 0xCA20);
        const colors = Array.from({ length: 32 }, (_, i) => i + 0x10);
        m.splice(0x3E0, 32, ...colors);
        for (let length = 0; length < 0x50; length++) {
            const prefix = Array.from({ length }, (_, i) => i ^ 0x55);
            m.splice(0x300, length, ...prefix);
            m[0x1E] = length;
            m[0x9A] = 0;
            call(nes, target(m, 0x8B94));
            assert.deepEqual(m.slice(0x300, 0x300 + length), prefix);
            assert.deepEqual(m.slice(0x300 + length, 0x300 + length + 38),
                [6, 0x3F, 0, 32, ...colors, 0xFF, 9]);
            assert.equal(m[0x1E], length + 38);
        }
        m[0x9A] = 1;
        const queue = m.slice(0x300, 0x3E0), length = m[0x1E];
        call(nes, target(m, 0x8B94));
        assert.deepEqual(m.slice(0x300, 0x3E0), queue);
        assert.equal(m[0x1E], length);
    }
});

realTest('native rescue scanner pauses before mutation and resumes at the next unprocessed nibble', () => {
    for (const expanded of [true]) {
        const editor = new RomEditor();
        editor.loadROM(original);
        editor.gameConfig.cameraFollow = true;
        if (expanded) editor.romType = Config.ROM_TYPE_EXPANDED;
        const nes = machine(editor.getROMData()), m = nes.cpu.mem;
        m[0x2A] = 1;
        m[0x3D] = 0;
        m[0x3E] = 3;
        m.splice(0x700, 224, ...Array(224).fill(0));
        m[0x710] = 0xFF; // Two rescues in the high/low nibbles of one map byte.
        m[0x67] = 0;
        m[0x68] = 0x10;
        m[0x69] = 0;
        m[0x6A] = 2;
        m[0x1E] = 16;
        const queue = m.slice(0x300, 0x310);
        call(nes, 0xA816, 1, 20000);
        assert.deepEqual(m.slice(0x300, 0x310), queue, 'a full queue is untouched');
        assert.equal(m[0x68], 0x10);
        assert.equal(m[0x69], 0);
        assert.equal(m[0x6A], 2, 'the animation phase waits for scan completion');
        m[0x1E] = 0;
        call(nes, 0xA816, 1, 20000);
        assert.equal(m[0x1E], 16);
        assert.equal((m[0x305] << 8) | m[0x306], 0x2040);
        assert.equal(m[0x68], 0x10);
        assert.equal(m[0x69], 1, 'resume at the second head, not the already drawn first head');
        assert.equal(m[0x6A], 2);
        m[0x1E] = 0;
        call(nes, 0xA816, 1, 20000);
        assert.equal(m[0x1E], 16);
        assert.equal((m[0x305] << 8) | m[0x306], 0x2042);
        assert.equal(m[0x68] | m[0x69], 0, 'completed scan resets its cursor');
        assert.equal(m[0x6A], 3);
        assert.equal(m[0x67], 5, 'original inter-scan delay is retained');
    }
});

realTest('stage 1 palette updates preserve the original ground tiles in both runtime views', () => {
    const ground = nes => nes.ppu.nameTable[0].tile.slice(768, 800);
    const baseline = ground(start(original, 0));
    for (const expanded of [true]) for (const view of [0, 1]) {
        const editor = new RomEditor();
        editor.loadROM(original);
        editor.gameConfig.cameraFollow = true;
        if (expanded) editor.romType = Config.ROM_TYPE_EXPANDED;
        const nes = start(editor.getROMData(), view);
        assert.deepEqual(ground(nes), baseline, 'loading fade preserves the original ground');
        let paletteWrites = 0;
        const write = nes.mmap.write.bind(nes.mmap);
        nes.mmap.write = (address, value) => {
            if (address === 0x2007) {
                const ppuAddress = nes.ppu.vramAddress & 0x3FFF;
                if (ppuAddress >= 0x3F00 && ppuAddress < 0x3F20) paletteWrites++;
                assert.ok(ppuAddress < 0x3B00 || ppuAddress >= 0x3B20,
                    'palette data is never replayed into mirrored nametable memory');
            }
            return write(address, value);
        };
        for (let f = 0; f < 60; f++) {
            nes.frame();
            assert.deepEqual(ground(nes), baseline, 'live palette updates preserve the ground');
            assert.deepEqual(nes.ppu.nameTable[1].tile.slice(768, 800), baseline,
                'the repeated page also retains its ground');
        }
        assert.ok(paletteWrites > 0, 'the regression exercises actual palette updates');
        assert.equal(nes.cpu.REG_SP, 0x1FF);
    }
});

realTest('large enemy-9 initialization completes both pages before scene-7 fade-in', () => {
    for (const expanded of [true]) for (const index of [52, 54, 55]) {
        const editor = new RomEditor();
        editor.loadROM(original);
        editor.gameConfig.cameraFollow = true;
        if (expanded) editor.romType = Config.ROM_TYPE_EXPANDED;
        const level = editor.levels[index];
        editor.levels[0].data = level.data.slice();
        editor.levels[0].monsterData = level.monsterData.slice();
        editor.levelCount = 1;
        editor.gameConfig.disableTimer = true;
        const nes = start(editor.getROMData(), 1), m = nes.cpu.mem;
        assert.equal(m[0x3D], 0);
        assert.equal(m[0x3E], 7);
        let scrollRestores = 0;
        const write = nes.mmap.write.bind(nes.mmap);
        nes.mmap.write = (address, value) => {
            if (address === 0x2007 || address === 0x2005) {
                assert.ok(nes.ppu.scanline < 20, 'scene-7 live updates finish before pre-render');
                if (address === 0x2005) scrollRestores++;
            }
            return write(address, value);
        };
        for (let f = 0; f < 60; f++) {
            assert.deepEqual(nes.ppu.vramMem.slice(0x2000, 0x23F8),
                nes.ppu.vramMem.slice(0x2400, 0x27F8),
                'every initially drawn enemy and attribute appears on both pages');
            nes.frame();
            assert.equal(m[0x30], 12);
        }
        assert.ok(scrollRestores > 0);
        assert.equal(nes.cpu.REG_SP, 0x1FF);
    }
});

realTest('both runtime views cross both seams and keep live pages synchronized in expanded exports', () => {
    for (const expanded of [true]) for (const wide of [false, true]) for (const view of [0, 1]) {
        const nes = start(exportStage(expanded, wide, 8), view), m = nes.cpu.mem;
        assert.equal(m[0x2A], view);
        assert.equal(m[0x3D], Number(wide));
        assert.equal(m[0x3C], 1);
        const circumference = wide ? 512 : 256;
        const initialY = m[0x41E];
        let lateVramWrites = 0;
        const write = nes.mmap.write.bind(nes.mmap);
        nes.mmap.write = (address, value) => {
            // Rendering is disabled during transfer; checking visibility here
            // would miss precisely the overrun that delays scroll restoration.
            if ((address === 0x2007 || address === 0x2005) &&
                nes.ppu.scanline >= 20 && nes.ppu.scanline < 261) lateVramWrites++;
            return write(address, value);
        };
        for (const button of [jsnes.Controller.BUTTON_RIGHT, jsnes.Controller.BUTTON_LEFT]) {
            nes.buttonDown(1, button);
            let crossed = false, previous = worldX(m);
            for (let f = 0; f < 600; f++) {
                nes.frame();
                const x = worldX(m);
                if (Math.abs(x - previous) > circumference / 2) crossed = true;
                previous = x;
                assert.equal(m[0x30], 12, 'gameplay continues');
                assert.equal(m[0x41E], initialY, 'player stays supported at the seam');
                assert.equal(cameraX(m), view ? (x - 128) & (circumference - 1) : wide ? Math.max(0,Math.min(255,x-128)) : 0);
                if (view) assert.equal(m[0x43C], 128);
            }
            nes.buttonUp(1, button);
            assert.equal(crossed, true, 'crossed the world boundary');
        }
        if (!wide && view) {
            assert.deepEqual(nes.ppu.vramMem.slice(0x2000, 0x23F8), nes.ppu.vramMem.slice(0x2400, 0x27F8));
            assert.deepEqual(m.slice(0x680, 0x6C0), m.slice(0x6C0, 0x700));
        }
        assert.equal(nes.cpu.REG_SP, 0x1FF);
        assert.equal(lateVramWrites, 0, 'background updates and scroll finish before pre-render');
    }
});

realTest('retry, stage transition, game over, title return, and ending reset the viewport and retain the view', () => {
    for (const expanded of [true]) for (const view of [0, 1]) {
        const nes = start(exportStage(expanded, true), view), m = nes.cpu.mem;
        const savedPC = nes.cpu.REG_PC;
        for (const hook of [0x8A60, 0x8A3A, 0x8C7E, 0x838E]) {
            m[0x2A] = view;
            m[0xFD] = 0xA6;
            m[0x9D] = 1;
            m[0xFF] = 0xB1;
            // Run the reset wrapper up to its original drawing routine. This
            // checks each entry BEFORE any background is rendered.
            const entry = target(m, hook);
            const stop = hook === 0x8A60 ? 0x8002
                : hook === 0x8C7E ? 0x83B8 : 0xDA2D;
            nes.cpu.REG_SP = 0x1FF;
            nes.cpu.REG_PC = 0x7FFF;
            nes.cpu.irqRequested = false;
            m[0x8000] = 0x20;
            m[0x8001] = entry & 255;
            m[0x8002] = entry >> 8;
            let reached = false;
            for (let i = 0; i < 50; i++) {
                nes.cpu.emulate();
                if (nes.cpu.REG_PC === stop) { reached = true; break; }
            }
            assert.equal(reached, true, `reset hook $${hook.toString(16)}`);
            assert.equal(m[0xFD] | m[0x9D] | (m[0xFF] & 1), 0);
            assert.equal(m[0x2A], hook === 0x838E ? 0 :
                [0x8A60,0x8A3A].includes(hook) ? view | 128 : view);
        }
        // Ending wrapper must preserve the graphics bank chosen by ending.
        m[0x2A] = view;
        m[0xFD] = 0xA6;
        m[0x9D] = 1;
        m[0xFF] = 0xB1;
        m[0x2F] = 5;
        nes.cpu.REG_PC = target(m, 0x8A34) - 1; // Jump-table word at $8A35
        nes.cpu.REG_SP = 0x1FF;
        for (let i = 0; i < 30 && nes.cpu.REG_PC !== 0xC5E7; i++) nes.cpu.emulate();
        assert.equal(nes.cpu.REG_PC, 0xC5E7);
        assert.equal(m[0xFD] | m[0x9D] | (m[0xFF] & 1), 0);
        assert.equal(m[0x2F], 5);
        assert.equal(m[0x2A], view);

        nes.cpu.REG_SP = 0x1FF;
        nes.cpu.REG_PC = savedPC;
        m[0x30] = 0;
        m[0x31] = 0;
        let resumed = false;
        for (let i = 0; i < 500; i++) {
            nes.frame();
            if (m[0x30] === 12 && m[0x56] === 3) { resumed = true; break; }
        }
        assert.equal(resumed, true);
        for(let i=0;i<140;i++) {
            const previous=cameraX(m);nes.frame();
            let delta=(cameraX(m)-previous)&511;if(delta>255)delta-=512;
            assert.ok(Math.abs(delta)<=4,'retry re-centers smoothly from loading scroll');
            if(!(m[0x2A]&128))break;
        }
        assert.equal(m[0x2A], view);
        assert.equal(cameraX(m), (worldX(m) - 128) & 511);
        assert.equal(nes.cpu.REG_SP, 0x1FF);
    }
});

realTest('single-screen rock pushes update both backgrounds across either edge in LOOP VIEW', () => {
    for (const expanded of [true]) for (const right of [false, true]) {
        const nes = start(exportStage(expanded, false, 0, right ? 'right' : true), 1), m = nes.cpu.mem;
        const write = nes.mmap.write.bind(nes.mmap);
        nes.mmap.write = (address, value) => {
            if (address === 0x2007 || address === 0x2005) {
                assert.ok(nes.ppu.scanline < 20, 'rock and rescue updates finish before pre-render');
            }
            return write(address, value);
        };
        const button = right ? jsnes.Controller.BUTTON_RIGHT : jsnes.Controller.BUTTON_LEFT;
        const sourceRock = () => right ? m[0x7B7] & 15 : m[0x7B0] >> 4;
        const destinationRock = () => right ? m[0x7B0] >> 4 : m[0x7B7] & 15;
        nes.buttonDown(1, button);
        for (let f = 0; f < 95; f++) {
            nes.frame();
            if (destinationRock() === 10 && sourceRock() === 0) break;
        }
        nes.buttonUp(1, button);
        nes.frame();
        assert.equal(m[0x30], 12);
        assert.equal(sourceRock(), 0, 'source rock removed');
        assert.equal(destinationRock(), 10, 'rock lands across the map edge');
        assert.deepEqual(nes.ppu.vramMem.slice(0x2000, 0x23F8), nes.ppu.vramMem.slice(0x2400, 0x27F8));
        assert.equal(nes.cpu.REG_SP, 0x1FF);
    }
});

realTest('re-export is byte-stable and original password digits and ending remain intact', () => {
    for (const expanded of [true]) {
        const editor = new RomEditor();
        editor.loadROM(original);
        editor.gameConfig.cameraFollow = true;
        if (expanded) editor.romType = Config.ROM_TYPE_EXPANDED;
        const data = editor.getROMData();
        const reloaded = new RomEditor();
        reloaded.loadROM(data);
        reloaded.gameConfig.cameraFollow = true;
        assert.deepEqual(reloaded.getROMData(), data);
        // An already exported ROM may retain the previous short-palette
        // call and helper. Loading it must install the new scheduler fully.
        const previous = new Uint8Array(data);
        previous.set([0x20, 0x54, 0x82], 0x8B94 - 0x8000 + 16);
        previous.fill(0xEA, 0x8254 - 0x8000 + 16, 0x827B - 0x8000 + 16);
        previous.set([0x20, 0xA5, 0xB7], 0xB867 - 0x8000 + 16);
        previous[0x9B51 - 0x8000 + 16] = 5; // Previous finalizer excluded state 13.
        previous[0xAC72 - 0x8000 + 16] = 0x48; // Native bat boundary entry.
        const fixedShift = expanded ? 6 * 0x4000 : 0;
        previous.fill(0xAA, 0xC4C5 - 0x8000 + 16 + fixedShift,
            0xC4C8 - 0x8000 + 16 + fixedShift);
        previous[0xC5E7 - 0x8000 + 16 + fixedShift] = 0xAA;
        const migrated = new RomEditor();
        migrated.loadROM(previous);
        migrated.gameConfig.cameraFollow = true;
        assert.deepEqual(migrated.getROMData(), data, 'previous palette, door and queue helpers are replaced');
        const shift = expanded ? 6 * 0x4000 : 0;
        assert.deepEqual(data.slice(0x827B - 0x8000 + 16, 0x8285 - 0x8000 + 16),
            new Uint8Array(original.subarray(0x827B - 0x8000 + 16, 0x8285 - 0x8000 + 16)),
            'stage initializer next to the queue helper remains intact');
        for (const [begin, end] of [[0xC4C8, 0xC578], [0xC5E8, 0xC676]]) {
            assert.deepEqual(data.slice(begin - 0x8000 + 16 + shift, end - 0x8000 + 16 + shift),
                new Uint8Array(original.subarray(begin - 0x8000 + 16, end - 0x8000 + 16)));
        }
    }
});

// Runtime transitions are tested against the ring, independently of rendering.
test('Up transitions take the shortest route, settle, and preserve vertical scroll', () => {
    const nes = syntheticMachine(),m=nes.cpu.mem;
    m[0x56]=3; m[0x1F]=0; m[0xFC]=17;
    for(const wide of [0,1]) for(const mode of [0,1]) {
        const mask=wide?511:255;
        for(const current of [0,1,4,127,128,250,252,255,256,383,511].filter(x=>x<=mask)) {
            for(const world of [0,1,127,128,255,256,383,511].filter(x=>x<=mask)) {
                m[0x3D]=wide;m[0x2A]=mode^1;m[0xFD]=current&255;m[0x9D]=current>>8;
                m[0xC2]=world&255;m[0xC1]=world>>8;m[0xF4]=8;
                const target=mode?(world-128)&mask:wide?Math.max(0,Math.min(255,world-128)):0;
                let previous=current;
                for(let frame=0;frame<140;frame++) {
                    call(nes,0x9B38);m[0xF4]=0;
                    const camera=m[0xFD]|m[0x9D]<<8;
                    let delta=(camera-previous)&mask;if(delta>(mask>>1))delta-=mask+1;
                    assert.ok(Math.abs(delta)<=4,'transition never teleports');
                    assert.equal(m[0xFC],17,'horizontal change cannot alter Y scroll');
                    previous=camera;
                    if(!(m[0x2A]&128))break;
                }
                assert.equal(previous,target);assert.equal(m[0x2A],mode);
            }
        }
    }
});
realTest('held Up toggles once; a second press restores fixed view with synchronized backgrounds',()=>{
    const nes=start(exportRescueStage(true,false),0),m=nes.cpu.mem;
    m[0xC2]=32; m[0xC1]=0;
    for(let i=0;i<100;i++)nes.frame();
    const checkPages=()=>assert.deepEqual(nes.ppu.vramMem.slice(0x2000,0x23F8),nes.ppu.vramMem.slice(0x2400,0x27F8));
    checkPages();
    const initialY=m[0xFC];let late=0;const write=nes.mmap.write.bind(nes.mmap);
    nes.mmap.write=(addr,value)=>{if((addr===0x2005||addr===0x2007)&&nes.ppu.scanline>=20&&nes.ppu.scanline<261)late++;return write(addr,value);};
    for(const mode of [1,0]) {
        nes.buttonDown(1,jsnes.Controller.BUTTON_UP);
        for(let i=0;i<100;i++){nes.frame();checkPages();assert.equal(m[0x2A]&1,mode);assert.equal(m[0xFC],initialY);}
        nes.buttonUp(1,jsnes.Controller.BUTTON_UP);nes.frame();
        assert.equal(m[0x2A],mode);
        assert.equal(cameraX(m),mode?(worldX(m)-128)&255:0);
    }
    assert.equal(late,0);assert.equal(nes.cpu.REG_SP,0x1FF);
});
realTest('exports share one layout, keep native password code, and recognize skins without a whole-ROM hash',()=>{
    const e=new RomEditor();e.loadROM(original);
    assert.equal(e.romType,Config.ROM_TYPE_EXPANDED);
    const skin=new Uint8Array(original);skin[0xAA70]^=0x55;
    assert.equal(RomEditor.inspectROM(skin).kind,'original');
    for(const enabled of [false,true]) {
        e.gameConfig.cameraFollow=enabled;const data=e.getROMData();
        assert.equal(data.length,0x20010);assert.equal(data[4],8);assert.equal(data[5],0);
        assert.equal(RomEditor.inspectROM(data).kind,'current');
        assert.equal(data[0xAC72-0x8000+16],enabled?0x5C:0x48);
        for(const [a,b] of [[0xC3CF,0xC4C8],[0xC578,0xC5E8]])
            assert.deepEqual(data.slice(a-0x8000+16+0x18000,b-0x8000+16+0x18000),new Uint8Array(original.subarray(a-0x8000+16,b-0x8000+16)));
        const legacy=data.slice();legacy.fill(0,0x18010,0x1801A);
        assert.equal(RomEditor.inspectROM(legacy).kind,'legacy');
        legacy[0xAA70]^=0xAA;
        assert.equal(RomEditor.inspectROM(legacy).kind,'legacy');
        const forced=new RomEditor();forced.loadROM(legacy);
        assert.equal(RomEditor.inspectROM(forced.getROMData()).kind,'legacy','unsafe base remains marked after export');
    }
});
