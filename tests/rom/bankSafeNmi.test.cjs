const assert = require('node:assert/strict');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');
const {expandMapper, Portal} = require('../helpers/source.cjs').load('expandMapper Portal');

function machine() {
    const rom = new Uint8Array(0x20010);
    rom.set([0x4E,0x45,0x53,0x1A]);
    expandMapper(rom);
    // Stand in for the native NMI body, including the guard's saved X/A.
    rom.set([0xE6,0x70,0x68,0xAA,0x68,0x40],0x10 + 0x807F - 0x8000);
    const n = new jsnes.NES({onFrame(){},emulateSound:false});
    n.loadROM(Buffer.from(rom).toString('binary'));
    return n;
}

function interrupt(n, {bank, guard, pc, native}) {
    const c = n.cpu, m = c.mem;
    n.mmap.write(0x8000,bank); n.mmap.write(0x2000,0x80);
    m[Portal.PORTAL_RAM.bankActive] = guard; m[0x70] = 0;
    c.REG_PC = pc - 1; c.REG_SP = 0x1D0;
    c.REG_ACC = 0x39; c.REG_X = 4; c.REG_Y = 11; c.F_CARRY = 1;
    c.irqRequested = false; c.requestIrq(c.IRQ_NMI);
    let cycles = 0;
    for (let i = 0; i < 40; i++) {
        cycles += c.emulate();
        if (c.REG_PC === 0x807E && c.REG_SP !== 0x1D0) {
            assert.equal(bank,0,`NMI must not enter the bank-0 handler with bank ${bank} mapped at interrupted PC $${pc.toString(16)}`);
            assert.ok(cycles <= 21,'native entry stays within the old idle-path budget for exit drawing');
        }
        if (c.REG_PC === pc - 1 && c.REG_SP === 0x1D0) {
            assert.equal(m[0x70],native ? 1 : 0);
            assert.deepEqual([c.REG_ACC,c.REG_X,c.REG_Y,c.F_CARRY],[0x39,4,11,1]);
            assert.equal(m[Portal.PORTAL_RAM.bankActive],guard);
            return;
        }
    }
    assert.fail('NMI did not return to the interrupted instruction with a balanced stack');
}

test('bank guard covers the entire $80xx page, including penguin smoke and native callbacks', () => {
    const n = machine();
    for (const bank of [6,1,4]) for (const pc of [0x8030,0x8070,0x807F,0x80CB,0x8100,0x8600,0xF936,0xFF51])
        interrupt(n,{bank,guard:bank,pc,native:false});
    interrupt(n,{bank:0,guard:6,pc:0x80DA,native:false});
});

test('ordinary NMIs run in bank 0 and guarded level loaders defer them', () => {
    const n = machine();
    for (const pc of [0x8070,0x80DA,0x891B,0xFFDA]) interrupt(n,{bank:0,guard:0,pc,native:true});
    for (const bank of [1,4]) for (const pc of [0xF004,0xF08E,0xF0D6])
        interrupt(n,{bank,guard:bank,pc,native:false});
});

test('every level-data loader survives NMI at each instruction, including both sides of mapper writes', () => {
    // File offsets of the ten generated loader JSRs (not their callers'
    // complete routines). A few hooks have a TXA/ASL prefix before the JSR.
    const hooks = [0xD32,0xD19,0x2929,0x1B1C,0x35F9,0x2DD9,0x2DE6,0x2E11,0x2DC9,0xAE5];
    const run = (hook, injected) => {
        const n = machine(), c = n.cpu, m = c.mem;
        const at = hook + 0x8000 - 0x10, entry = m[at+1] | m[at+2] << 8;
        assert.equal(m[at],0x20);
        n.mmap.write(0x2000,0x80);
        m[Portal.PORTAL_RAM.bankActive] = 0;
        let bank = 0, switches = 0;
        const write = n.mmap.write.bind(n.mmap);
        n.mmap.write = (address,value) => {
            if (address === 0x8000) {
                assert.ok(m[Portal.PORTAL_RAM.bankActive],'guard is raised before every mapper write');
                bank = value; switches++;
            }
            return write(address,value);
        };
        m.splice(0x6000,3,0x20,entry & 255,entry >> 8);
        m[0] = m[6] = 0; m[1] = m[7] = 0x90;
        c.REG_PC = 0x5FFF; c.REG_SP = 0x1FF;
        c.REG_ACC = 4; c.REG_X = 3; c.REG_Y = 2; c.F_CARRY = 1; c.irqRequested = false;
        for (let step = 0; step < 100; step++) {
            if (injected) {
                const pc = c.REG_PC, sp = c.REG_SP;
                c.requestIrq(c.IRQ_NMI);
                let returned = false;
                for (let i = 0; i < 30; i++) {
                    c.emulate();
                    if (c.REG_PC === 0x807E && c.REG_SP !== sp) assert.equal(bank,0);
                    if (c.REG_PC === pc && c.REG_SP === sp) {returned = true; break;}
                }
                assert.ok(returned,'NMI returns to the exact loader instruction');
            }
            c.emulate();
            if (c.REG_PC === 0x6002) {
                assert.equal(c.REG_SP,0x1FF); assert.equal(bank,0); assert.equal(switches,2);
                assert.equal(m[Portal.PORTAL_RAM.bankActive],0);
                return {registers:[c.REG_ACC,c.REG_X,c.REG_Y,c.F_CARRY,c.F_ZERO === 0,c.F_SIGN],
                    scratch:m.slice(0,0x20),objects:m.slice(0x400,0x600)};
            }
        }
        assert.fail('loader did not return');
    };
    for (const hook of hooks) assert.deepEqual(run(hook,true),run(hook,false),`loader at hook $${hook.toString(16)}`);
});
