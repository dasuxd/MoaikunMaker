const assert = require('node:assert/strict');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');
const { RamAccessTracker, RamRecorder, RamRecordingStore } = require('../js/RamRecorder.js');

function rom(program) {
    const bytes = new Uint8Array(16 + 2 * 0x4000);
    bytes.set([0x4E, 0x45, 0x53, 0x1A, 2, 0, 0x21]);
    bytes.set(program, 16);
    bytes.set([0x00,0x80,0x00,0x80,0x00,0x80], bytes.length - 6);
    return bytes;
}
function machine(program) {
    const nes = new jsnes.NES({ onFrame() {}, emulateSound: false });
    nes.loadROM(Buffer.from(rom(program)).toString('binary'));
    nes.cpu.irqRequested = false;
    nes.cpu.REG_PC = 0x7FFF;
    return nes;
}
function observe(nes, boot = true) {
    const tracker = new RamAccessTracker(nes, { romHash:'a'.repeat(64), romSize:0x8010 });
    tracker.started = boot;
    tracker.attach();
    return tracker;
}
function steps(nes, count) { for (let i=0;i<count;i++) nes.cpu.emulate(); }
function storage() {
    const map = new Map();
    return { get length() { return map.size; }, key(i) { return [...map.keys()][i]; },
        getItem(key) { return map.get(key) ?? null; }, setItem(key,value) { map.set(key,String(value)); },
        removeItem(key) { map.delete(key); } };
}
function memoryStore() {
    const values = new Map();
    return { values, journal() {}, recover: async () => {},
        put: async snapshot => { values.set(snapshot.id, structuredClone(snapshot)); },
        list: async () => [...values.values()].map(value => structuredClone(value)) };
}

test('counts same-value writes and mirrored reads at their physical RAM address', () => {
    const nes = machine([0xA9,7, 0x85,0x10, 0x8D,0x10,0x08, 0xAD,0x10,0x18]);
    nes.cpu.mem[0x10] = 0;
    const tracker = observe(nes);
    steps(nes,4);
    assert.equal(tracker.counts.writes[0x10],2);
    assert.equal(tracker.counts.changes[0x10],1);
    assert.equal(tracker.counts.reads[0x10],1);
    assert.equal(tracker.lastValues[0x10],7);
    assert.equal(tracker.codes[tracker.writeSources[0x10][0]], 'game CPU B0 $8002');
    // UI inspections and copying a save are host activity, not game reads.
    const before = tracker.snapshot();
    void nes.cpu.mem[0x10];
    JSON.stringify(nes.toJSON());
    assert.deepEqual(tracker.snapshot().counts, before.counts);
    tracker.detach();
});

test('last values follow executed reads/writes in both phases, not host inspection or save restoration', () => {
    const nes = machine([0xA9,0,0x85,0x60,0xA9,0xFF,0x85,0x61,0xA9,9,0x85,0x61,0xA5,0x62]);
    const tracker = observe(nes,false);
    assert.equal(tracker.lastValues[0x60],-1);
    steps(nes,4);
    assert.equal(tracker.lastValues[0x60],0);
    assert.equal(tracker.lastValues[0x61],255);
    assert.equal(RamAccessTracker.category(tracker.counts,0x60),'loading');
    assert.ok(tracker.lastValueTimes[0x60]>0);
    tracker.started=true;
    steps(nes,2);
    assert.equal(tracker.lastValues[0x61],9);
    assert.equal(RamAccessTracker.category(tracker.counts,0x61),'written');
    nes.cpu.mem[0x62]=23; // Host mutation is not an observed access.
    assert.equal(tracker.lastValues[0x62],-1);
    steps(nes,1);
    assert.equal(tracker.lastValues[0x62],23);
    const before=tracker.snapshot();
    const state=tracker.suspend(()=>nes.toJSON());
    tracker.suspend(()=>nes.fromJSON(state),true);
    nes.cpu.mem[0x61]=0;
    assert.deepEqual(tracker.snapshot().lastValues,before.lastValues);
    assert.deepEqual(tracker.snapshot().lastValueTimes,before.lastValueTimes);
    assert.equal(RamAccessTracker.validate(before),before);
    tracker.detach();
});

test('old records keep unknown values and malformed value backups are rejected', () => {
    const tracker = new RamAccessTracker(machine([]),{romHash:'a'.repeat(64)});
    const legacy=tracker.snapshot(); delete legacy.lastValues; delete legacy.lastValueTimes;
    assert.equal(RamAccessTracker.validate(legacy),legacy);
    assert.equal(RamRecorder.latestValues([legacy]).values[0],-1);
    const valid=tracker.snapshot();
    for (const mutate of [v=>v.lastValues[0]=256, v=>v.lastValues[0]=null,
        v=>v.lastValues[0]=0, v=>v.lastValueTimes[0]=-1, v=>delete v.lastValueTimes,
        v=>v.lastValues.pop()]) {
        const invalid=structuredClone(valid); mutate(invalid);
        assert.throws(()=>RamAccessTracker.validate(invalid),/Invalid RAM last values/);
    }
});

test('combined values use per-address observation times rather than later checkpoint times', () => {
    const tracker = new RamAccessTracker(machine([]),{romHash:'a'.repeat(64)});
    const a=tracker.snapshot(),b=tracker.snapshot();
    a.id='a'; b.id='b'; a.createdAt=10; b.createdAt=20;
    a.updatedAt=900; b.updatedAt=400;
    a.lastValues[0x60]=0; a.lastValueTimes[0x60]=100;
    b.lastValues[0x60]=255; b.lastValueTimes[0x60]=200;
    a.lastValues[0x61]=7; a.lastValueTimes[0x61]=300;
    b.lastValues[0x61]=8; b.lastValueTimes[0x61]=300;
    a.lastValues[0x62]=3; a.lastValueTimes[0x62]=100;
    for (const records of [[a,b],[b,a]]) {
        const latest=RamRecorder.latestValues(records);
        assert.equal(latest.values[0x60],255);
        assert.equal(latest.sources[0x60].id,'b');
        assert.equal(latest.values[0x61],8);
        assert.equal(latest.values[0x62],3);
        assert.equal(latest.values[0x63],-1);
    }
});

test('captures indirect pointer reads, the direct-array JMP path, JSR and stack pushes/pulls', () => {
    const nes = machine([0xA0,0, 0xB1,0x20, 0x48,0x68, 0x20,0x20,0x81, 0x6C,0x22,0]);
    nes.cpu.mem[0x20]=0x40; nes.cpu.mem[0x21]=0;
    nes.cpu.mem[0x40]=37;
    nes.cpu.mem[0x22]=0x30; nes.cpu.mem[0x23]=0x81;
    nes.cpu.mem[0x8120]=0x60;
    const tracker=observe(nes);
    steps(nes,7);
    for (const address of [0x20,0x21,0x40,0x22,0x23]) assert.equal(tracker.counts.reads[address],1);
    assert.ok(tracker.counts.writes[0x1FF]>=2);
    assert.ok(tracker.counts.reads[0x1FF]>=2);
    assert.equal(nes.cpu.REG_PC,0x812F);
    assert.equal(nes.cpu.REG_ACC,37);
    tracker.detach();
});

test('records all sprite DMA RAM reads without counting profiler inspection as reads', () => {
    const nes=machine([0xA9,2,0x8D,0x14,0x40]);
    const tracker=observe(nes);
    steps(nes,2);
    for(let address=0x200;address<0x300;address++) assert.equal(tracker.counts.reads[address],1);
    assert.equal(tracker.counts.reads[0x56],0);
    assert.equal(tracker.counts.writes.reduce((sum,n)=>sum+n,0),0);
    tracker.detach();
});

test('startup accesses remain separate and collection continues through a later death/menu', () => {
    const nes=machine([0xA9,0,0x85,0x60,0x4C,0,0x80]);
    const tracker=observe(nes,false);
    steps(nes,2);
    assert.equal(tracker.counts.loadingWrites[0x60],1);
    assert.equal(tracker.counts.writes[0x60],0);
    nes.cpu.mem[0x18]=4; nes.cpu.mem[0x30]=12; nes.cpu.mem[0x56]=3;
    steps(nes,3);
    assert.equal(tracker.counts.writes[0x60],1);
    nes.cpu.mem[0x30]=0;
    steps(nes,3);
    assert.equal(tracker.counts.writes[0x60],2);
    assert.equal(tracker.counts.loadingWrites[0x60],1);
    tracker.detach();
});

test('sources identify the switched PRG bank and interrupt handler PC', () => {
    const bytes=rom([0xA9,1,0x8D,0,0x80]);
    // Bank 1 becomes mapped at both windows; its program starts at $8005.
    bytes.set([0xA9,9,0x85,0x61],16+0x4000+5);
    bytes.set([0xA9,6,0x85,0x62,0x40],16+0x4000+0x100);
    bytes.set([0,0xC1],bytes.length-6);
    const nes=machine([]); nes.loadROM(Buffer.from(bytes).toString('binary'));
    nes.cpu.irqRequested=false; nes.cpu.REG_PC=0x7FFF;
    nes.cpu.mem[0x2000]=0x80;
    const tracker=observe(nes);
    steps(nes,4);
    assert.equal(tracker.codes[tracker.writeSources[0x61][0]],'game CPU B1 $8007');
    nes.cpu.requestIrq(nes.cpu.IRQ_NMI);
    steps(nes,2);
    assert.equal(tracker.codes[tracker.writeSources[0x62][0]],'game CPU B1 $C102');
    assert.ok(tracker.counts.writes[0x1FF]>0);
    tracker.detach();
});

test('detaching restores the original memory and all methods; disabled recording has no hooks', async () => {
    const nes=machine([0x4C,0,0x80]);
    const original={mem:nes.cpu.mem,emulate:nes.cpu.emulate,frame:nes.frame,loadRomBank:nes.mmap.loadRomBank};
    const tracker=observe(nes); tracker.detach();
    assert.equal(nes.cpu.mem,original.mem); assert.equal(nes.cpu.emulate,original.emulate);
    assert.equal(nes.frame,original.frame); assert.equal(nes.mmap.loadRomBank,original.loadRomBank);
    const recorder=new RamRecorder({storage:storage(),store:memoryStore()});
    recorder.load({nes},rom([0x4C,0,0x80]));
    assert.equal(recorder.tracker,null); assert.equal(nes.cpu.mem,original.mem);
    assert.equal(nes.cpu.emulate,original.emulate); assert.equal(recorder.timer,null);
});

test('quick-load restoration replaces memory without rewinding the observations', () => {
    const nes=machine([0xA9,7,0x85,0x60,0x4C,0,0x80]);
    const tracker=observe(nes);
    const state=tracker.suspend(()=>JSON.stringify(nes.toJSON()));
    steps(nes,2);
    const before=tracker.counts.writes[0x60];
    const oldMemory=tracker.rawMemory;
    tracker.suspend(()=>nes.fromJSON(JSON.parse(state)),true);
    assert.notEqual(tracker.rawMemory,oldMemory);
    assert.equal(tracker.counts.writes[0x60],before);
    nes.cpu.irqRequested=false;
    steps(nes,2);
    assert.equal(tracker.counts.writes[0x60],before+1);
    assert.equal(tracker.restores,1);
    tracker.detach();
});

test('observation preserves complete machine behavior including frame execution', () => {
    const program=[0xE6,0x60,0xA5,0x60,0x85,0x61,0x4C,0,0x80];
    const plain=machine(program), observed=machine(program);
    const tracker=observe(observed);
    for(let i=0;i<6;i++) { plain.frame(); observed.frame(); }
    tracker.detach();
    assert.deepEqual(observed.toJSON(),plain.toJSON());
    assert.equal(tracker.frames,6);
    assert.ok(tracker.counts.reads[0x60]>0);
});

test('saved preference survives new controllers and records accumulate across ROM runs', async () => {
    const local=storage(), store=memoryStore(), program=[0xA9,7,0x85,0x60];
    const recorder=new RamRecorder({storage:local,store});
    recorder.setStartMode('boot');
    assert.equal(recorder.setEnabled(true),true);
    recorder.load({nes:machine(program)},rom(program));
    const first=recorder.tracker;
    steps(first.nes,2); await first.ready; await recorder.flush();
    recorder.stop();
    recorder.load({nes:machine(program)},rom(program));
    steps(recorder.tracker.nes,2); await recorder.tracker.ready;
    const records=await recorder.records();
    assert.equal(records.length,2);
    assert.equal(records[0].romHash,records[1].romHash);
    assert.equal(RamRecorder.aggregate(records).writes[0x60],2);
    recorder.stop(); clearInterval(recorder.timer);
    const reopened=new RamRecorder({storage:local,store});
    assert.deepEqual(reopened.settings,{enabled:true,startMode:'boot'});
    assert.equal((await reopened.records()).length,2);
    reopened.setEnabled(false);
});

test('failed persistence retains counters for retry and preference failures are visible', async () => {
    const local=storage(), store=memoryStore();
    const recorder=new RamRecorder({storage:local,store});
    recorder.setStartMode('boot'); recorder.setEnabled(true);
    recorder.load({nes:machine([0xE6,0x60])},rom([0xE6,0x60]));
    await recorder.tracker.ready;
    const tracker=recorder.tracker;
    const original=store.put;
    store.put=async()=>{throw new Error('disk full');};
    steps(tracker.nes,1);
    await recorder.flush();
    assert.equal(recorder.error,'disk full');
    assert.notEqual(tracker.savedRevision,tracker.revision);
    store.put=original;
    await recorder.flush();
    assert.equal(store.values.get(tracker.metadata.id).counts.writes[0x60],1);
    assert.equal(recorder.error,'');
    recorder.setEnabled(false);
    local.setItem=()=>{throw new Error('blocked');};
    assert.equal(recorder.setEnabled(true),false);
    assert.equal(recorder.settings.enabled,false);
    assert.equal(recorder.error,'blocked');
});

test('candidate selection considers reads and startup access, and excludes known buffers', () => {
    const tracker=new RamAccessTracker(machine([]),{romHash:'a'.repeat(64)});
    tracker.counts.loadingWrites[0x60]=1;
    tracker.counts.loadingReads[0x61]=1;
    tracker.counts.writes[0x62]=1;
    assert.equal(RamAccessTracker.category(tracker.counts,0x60),'loading');
    assert.equal(RamAccessTracker.category(tracker.counts,0x61),'read');
    assert.equal(RamAccessTracker.category(tracker.counts,0x62),'written');
    assert.equal(RamAccessTracker.category(tracker.counts,0x63),'unseen');
    for(const address of [0x2A,0x75,0x7C,0x7D,0x9D,0x100,0x200,0x300,0x700]) assert.equal(RamAccessTracker.category(tracker.counts,address),'reserved');
    const snapshot=tracker.snapshot();
    assert.equal(RamAccessTracker.validate(snapshot),snapshot);
    snapshot.counts.reads[0]=-1;
    assert.throws(()=>RamAccessTracker.validate(snapshot),/Invalid RAM counters/);
});

test('journals are synchronous and an old backup cannot replace a newer checkpoint', () => {
    const local=storage(), store=new RamRecordingStore(null,local);
    const tracker=new RamAccessTracker(machine([]),{romHash:'a'.repeat(64)});
    tracker.revision=10; const newer=tracker.snapshot();
    store.journal(newer);
    tracker.revision=5; store.journal(tracker.snapshot());
    const stored=JSON.parse(local.getItem(RamRecordingStore.JOURNAL_PREFIX+tracker.metadata.id));
    assert.equal(stored.revision,10);
});

test('a checkpoint remains recoverable even before asynchronous ROM hashing finishes', async () => {
    const local=storage(), store=memoryStore();
    const journals=[];store.journal=snapshot=>journals.push(structuredClone(snapshot));
    let finishHash;
    const recorder=new RamRecorder({storage:local,store,crypto:{subtle:{digest:()=>new Promise(resolve=>{finishHash=resolve})}}});
    recorder.setStartMode('boot');recorder.setEnabled(true);
    recorder.load({nes:machine([0xA9,7,0x85,0x60])},rom([0xA9,7,0x85,0x60]));
    const tracker=recorder.tracker;
    steps(tracker.nes,2);
    recorder.stop();
    assert.equal(journals[0].counts.writes[0x60],1);
    assert.match(journals[0].romHash,/^unhashed:/);
    assert.equal(RamAccessTracker.validate(journals[0]),journals[0]);
    await recorder.flush();
    finishHash(new Uint8Array(32).buffer);
    await tracker.ready;
    assert.equal(store.values.get(tracker.metadata.id).romHash,'0'.repeat(64));
    recorder.setEnabled(false);
});

test('applying another tab preferences does not echo intermediate writes', () => {
    const local=storage(), recorder=new RamRecorder({storage:local,store:memoryStore()});
    recorder.settings={enabled:true,startMode:'boot'};
    let writes=0;local.setItem=()=>{writes++};
    recorder.setStartMode('gameplay',false);
    recorder.setEnabled(false,false);
    assert.equal(writes,0);
    assert.deepEqual(recorder.settings,{enabled:false,startMode:'gameplay'});
});

test('color filters persist independently without changing recorder settings or counters', () => {
    const local=storage(), store=memoryStore(), recorder=new RamRecorder({storage:local,store});
    recorder.setStartMode('boot');
    const settings=local.getItem(RamRecorder.SETTINGS_KEY);
    recorder.setMapFilters({unseen:true,loading:true,written:false,read:false,reserved:false});
    assert.equal(local.getItem(RamRecorder.SETTINGS_KEY),settings);
    assert.equal(store.values.size,0);
    const reopened=new RamRecorder({storage:local,store});
    assert.deepEqual(reopened.mapFilters,{unseen:true,loading:true,written:false,read:false,reserved:false});
    assert.deepEqual(reopened.settings,{enabled:false,startMode:'boot'});
    reopened.setMapFilters(null);
    assert.ok(Object.values(reopened.mapFilters).every(Boolean));
    assert.deepEqual(RamRecorder.normalizeFilters({unseen:false,loading:'bad',bogus:false}),
        {unseen:false,loading:true,written:true,read:true,reserved:true});
    for(const text of Object.values(RamRecorder.TEXT)) for(const category of Object.keys(RamRecorder.MAP_COLORS)) {
        assert.equal(typeof text[`${category}Meaning`],'string');
    }
});
