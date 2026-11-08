const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');
const {Project, LevelCodec, RemoteBomb, GraphicsCatalog} = require('../helpers/source.cjs')
    .load('Project LevelCodec RemoteBomb GraphicsCatalog');
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, body) => test(name, {skip: !original}, body);

function stage({scene = 0, wide = false, camera = false} = {}) {
    const p = new Project(); p.loadROM(original);
    p.gameConfig.disableTimer = true; p.gameConfig.cameraFollow = camera;
    const map = Array.from({length:14}, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(5); map[10][3] = 5; map[1][2] = 15;
    const data = LevelCodec.fromLevelEditorToROMData({background:scene | (wide ? 16 : 0),
        map, player:{x:3,y:11}, door:{x:14,y:10},
        enemies:Array.from({length:3}, () => ({enemyId:14,x:3,y:11}))},wide);
    p.levels[0].data = data.mapData; p.levels[0].monsterData = data.monsterData; p.levelCount = 1;
    return p.getROMData();
}
function start(options) {
    const nes = new jsnes.NES({onFrame(){},emulateSound:false});
    nes.loadROM(Buffer.from(stage(options)).toString('binary'));
    for(let i=0;i<160;i++)nes.frame();
    nes.buttonDown(1,jsnes.Controller.BUTTON_START);nes.frame();nes.buttonUp(1,jsnes.Controller.BUTTON_START);
    for(let i=0;i<700;i++) {
        nes.frame(); const m=nes.cpu.mem;
        if(m[0x30]===12 && m[0x56]===3 && !(m[0x2A]&128)) {
            for(let j=0;j<5;j++)nes.frame(); return nes;
        }
    }
    assert.fail('gameplay not reached');
}
const slots = (m,state) => Array.from({length:8},(_,i)=>i).filter(i=>m[0x4FE+i]===14 && (state===undefined || m[0x506+i]===state));
const buttons = {up:jsnes.Controller.BUTTON_UP, down:jsnes.Controller.BUTTON_DOWN,
    jump:jsnes.Controller.BUTTON_A, attack:jsnes.Controller.BUTTON_B};
function hold(nes, keys, frames=1) {for(const key of keys)nes.buttonDown(1,buttons[key]);for(let i=0;i<frames;i++)nes.frame();}
function release(nes) {for(const key of Object.values(buttons))nes.buttonUp(1,key);nes.frame();}
function tile(m,x,y) {const v=m[0x700+y*16+(x>>1)];return x&1?v&15:v>>4;}
function setTile(m,x,y,value) {const at=0x700+y*16+(x>>1);m[at]=x&1?(m[at]&240)|value:(m[at]&15)|(value<<4);}
function sounds(n) {
    const calls=[],emulate=n.cpu.emulate;
    n.cpu.emulate=function(){if(this.REG_PC+1===0x80DA)calls.push(this.REG_ACC);return emulate.call(this);};
    return calls;
}

function uiSounds(n) {
    const calls=[],emulate=n.cpu.emulate;
    n.cpu.emulate=function(){
        if(this.REG_PC+1===RemoteBomb.SOUND_BRIDGE && this.mem[0xD7])calls.push(this.mem[0xD7]);
        return emulate.call(this);
    };
    return calls;
}

realTest('installation cues occur at start and success, while cancellation and empty holds stay silent',()=>{
    const n=start(),m=n.cpu.mem,calls=uiSounds(n),s=RemoteBomb.SOUND;
    hold(n,['up'],20);assert.deepEqual(calls,[s.start]);
    release(n);assert.deepEqual(calls,[s.start]);
    for(let i=0;i<20;i++)n.frame();assert.equal(calls.length,1);
    for(let i=0;i<3;i++) {hold(n,['up']);release(n);}
    assert.deepEqual(calls,Array(4).fill(s.start),'rapid cancellation adds no sound');
    hold(n,['up'],60);assert.deepEqual(calls,[...Array(5).fill(s.start),s.success]);
    hold(n,['up'],20);release(n);assert.equal(calls.length,6,'completed placement cannot cancel');
    m[0xC2]=88;hold(n,['up'],20);release(n);assert.equal(calls.length,6,'no ceiling means no cue');
});

realTest('native APU plays start and rising success, stays silent on cancellation and restores music',()=>{
    const n=start(),m=n.cpu.mem,notes=[];
    for(let i=0;i<40;i++)n.frame(); // Let the initial native pickup finish.
    n.opts.emulateSound=true;
    const write=n.papu.writeReg;
    n.papu.writeReg=function(address,value){
        if(address===0x4002 && m[0x15B]===4 && m[0x10E]===0x17)notes.push(value);
        return write.call(this,address,value);
    };
    hold(n,['up'],25);assert.deepEqual(notes,[0xA9]);assert.equal(m[0x10E],0);
    notes.length=0;release(n);for(let i=0;i<20;i++)n.frame();
    assert.deepEqual(notes,[],'cancellation does not start another sound');assert.equal(m[0x10E],0);
    hold(n,['up'],58);notes.length=0;hold(n,['up'],20);
    assert.deepEqual(notes,[0xA9,0x70],'smaller pulse timer raises the pitch');
    assert.equal(m[0x10E],0);assert.ok(m[0x10A]>0,'background music continues');
});

realTest('pause, target changes, pickup priority and detonation do not spam installation cues',()=>{
    const n=start(),m=n.cpu.mem,calls=uiSounds(n),s=RemoteBomb.SOUND;
    hold(n,['up'],10);
    n.buttonDown(1,jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1,jsnes.Controller.BUTTON_START);
    for(let i=0;i<20;i++)n.frame();assert.deepEqual(calls,[s.start]);
    n.buttonDown(1,jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1,jsnes.Controller.BUTTON_START);n.frame();
    assert.deepEqual(calls,[s.start],'resume continues the same installation');
    for(let i=0;i<20;i++)n.frame(); // Native pause cue has higher priority.
    n.buttonUp(1,buttons.up);hold(n,['down']);assert.deepEqual(calls,[s.start,s.start]);
    hold(n,['attack','up']);assert.deepEqual(calls,[s.start,s.start],'detonation adds no installation cue');
    release(n);calls.length=0;const slot=slots(m,2)[0];m[0x506+slot]=1;m[0x516+slot]=m[0xC2];m[0x433+slot]=m[0x41E];
    hold(n,['up']);assert.deepEqual(calls,[],'pickup keeps its original sound when placement starts simultaneously');
});

realTest('remote pickup plays the same native sound as an ordinary bomb, once',()=>{
    const n=start(),m=n.cpu.mem,calls=sounds(n),s=slots(m,2)[0];
    m[0x506+s]=1;n.frame();
    assert.equal(m[0x506+s],2);assert.deepEqual(calls,[0x17]);
    for(let i=0;i<8;i++)n.frame();assert.equal(calls.filter(id=>id===0x17).length,1);
    calls.length=0;const count=m[0xCE];setTile(m,3,11,11);n.frame();
    assert.equal(m[0xCE],count+1);assert.equal(calls.filter(id=>id===0x17).length,1);
});

realTest('uncollected remote bombs match native bomb fall timing and landing',()=>{
    const n=start(),m=n.cpu.mem,s=slots(m,2)[0],calls=sounds(n);
    m[0x506+s]=1;m[0x516+s]=104;m[0x433+s]=88;m[0x55E+s]=0;m[0x56E+s]=0;
    // Register a native collectible bomb alongside it, as removing its support does.
    setTile(m,4,5,11);m[0x4C0]=255;m[0x4CA]=11;m[0x4D4]=8;m[0x4DE]=10;m[0x4E8]=0;
    const steps=[];let previous=88;
    const emulate=n.cpu.emulate;
    n.cpu.emulate=function(){
        // Background VRAM uploads may defer native falling; a sprite does
        // not need those uploads. Compare its unobstructed movement cadence.
        if(this.REG_PC+1===0xA505){this.mem[0x1E]=0;this.REG_X=0;this.mem[0x53]=0;}
        return emulate.call(this);
    };
    for(let i=0;i<80;i++) {
        n.frame();assert.equal(m[0x433+s],m[0x4DE]*8+8,`fall position on update ${i+1}`);
        if(m[0x433+s]!==previous){steps.push(i+1);previous=m[0x433+s];}
    }
    assert.equal(steps[0],11);for(let i=1;i<steps.length;i++)assert.equal(steps[i]-steps[i-1],5);
    assert.equal(m[0x433+s],184);assert.equal(m[0x56E+s],0);assert.equal(m[0x506+s],1);
    assert.equal(tile(m,4,11),11);assert.equal(tile(m,6,11),0,'remote stays a sprite collectible');
    assert.equal(calls.filter(id=>id===0x0F).length,2,'both bombs play native landing sound');
    m[0xC2]=104;n.frame();assert.equal(m[0x506+s],2);assert.equal(calls.at(-1),0x17);
    assert.equal(m[0x55E+s],0);assert.equal(m[0x56E+s],0,'fall state does not leak into preview');
});

realTest('pickup falling respects wide coordinates, missing support, pause and the bottom edge',()=>{
    const n=start({wide:true,camera:true}),m=n.cpu.mem,s=slots(m,2)[0];
    m[0x506+s]=1;m[0x50E+s]=1;m[0x516+s]=56;m[0x433+s]=152;m[0x55E+s]=0;m[0x56E+s]=0;
    setTile(m,19,10,5);for(let i=0;i<20;i++)n.frame();assert.equal(m[0x433+s],152);
    setTile(m,19,10,0);for(let i=0;i<13;i++)n.frame();assert.equal(m[0x433+s],160);
    n.buttonDown(1,jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1,jsnes.Controller.BUTTON_START);n.frame();
    const before=[m[0x433+s],m[0x55E+s],m[0x56E+s]];
    for(let i=0;i<20;i++)n.frame();assert.deepEqual([m[0x433+s],m[0x55E+s],m[0x56E+s]],before);
    n.buttonDown(1,jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1,jsnes.Controller.BUTTON_START);
    setTile(m,19,12,0);for(let i=0;i<60;i++)n.frame();
    assert.equal(m[0x4FE+s],0);assert.equal(m[0x415+s],0,'falling out removes the pickup');
});

test('only the 2x2 indicator light changes from highlight to the palette main colour',()=>{
    const patterns=RemoteBomb.patterns(); assert.equal(patterns.length,96);
    const pixel=(data,frame,x,y)=>{const at=(x<8?0:32+frame*32)+(y>>3)*16+(y&7),shift=7-(x&7);
        return (data[at]>>shift&1)|(data[at+8]>>shift&1)<<1;};
    for(let y=0;y<16;y++)for(let x=0;x<16;x++) {
        if(x>=11&&x<=12&&y>=3&&y<=4) {
            assert.equal(pixel(patterns,0,x,y),2);assert.equal(pixel(patterns,1,x,y),1);
        } else assert.equal(pixel(patterns,0,x,y),pixel(patterns,1,x,y));
    }
    assert.deepEqual(GraphicsCatalog.RESOURCE_IMG_CONFIG.enemy_14.disabledLevelType,[]);
});

realTest('holding up previews in the pickup colour and installs after 60 active ticks',()=>{
    const n=start(),m=n.cpu.mem;assert.equal(slots(m,2).length,3);
    const y=m[0x41E];hold(n,['up']);const s=m[RemoteBomb.RAM.inventory];
    assert.equal(m[0x506+s],2);assert.equal(m[0x415+s],RemoteBomb.META);
    assert.equal(m[0x46F+s],2);assert.equal(m[0x55E+s],1);
    hold(n,['up'],58);assert.equal(slots(m,3).length,0);assert.equal(m[0x55E+s],59);
    const previewOam=Array.from({length:64},(_,i)=>n.ppu.spriteMem.slice(i*4,i*4+4))
        .filter(([y,t])=>y<240&&[0x48,0x4A].includes(t));
    assert.equal(previewOam.length,2);for(const [, , palette] of previewOam)assert.equal(palette,2);
    hold(n,['up']);assert.equal(slots(m,3).length,1);assert.equal(slots(m,2).length,2);
    assert.equal(m[0x46F+s],1);assert.equal(m[0x526+s],1);
    assert.equal(m[0x536+s],3);assert.equal(m[0x546+s],10);assert.equal(tile(m,3,10),5);
    assert.equal(m[0x41E],y);hold(n,['up'],60);assert.equal(slots(m,3).length,1);
});

realTest('release and direction change cancel the preview without consuming inventory',()=>{
    const n=start(),m=n.cpu.mem;hold(n,['up'],15);const s=m[RemoteBomb.RAM.inventory];
    release(n);assert.equal(m[0x55E+s],0);assert.equal(m[0x415+s],0);assert.equal(slots(m,2).length,3);
    hold(n,['up'],12);n.buttonUp(1,buttons.up);hold(n,['down']);
    assert.equal(m[0x55E+s],1);assert.equal(m[0x546+s],12);assert.equal(slots(m,3).length,0);
    hold(n,['down'],59);assert.equal(slots(m,3).length,1);assert.equal(m[0x546+s],12);
});

realTest('a changed or missing target resets installation time',()=>{
    const n=start(),m=n.cpu.mem;hold(n,['up'],15);const s=m[RemoteBomb.RAM.inventory];
    m[0xC2]=88;m[0x700+10*16+2]=5;hold(n,['up']);
    assert.equal(m[0x55E+s],1);assert.equal(m[0x536+s],5);
    m[0x700+10*16+2]=0;hold(n,['up']);
    assert.equal(m[0x55E+s],0);assert.equal(m[0x415+s],0);assert.equal(slots(m,2).length,3);
});

realTest('floor installation, duplicate cells and empty ceilings preserve inventory',()=>{
    const n=start(),m=n.cpu.mem;
    hold(n,['down'],60);release(n);
    assert.equal(slots(m,3).length,1);assert.equal(m[0x546+slots(m,3)[0]],12);
    hold(n,['down'],40);release(n);assert.equal(slots(m,2).length,2);
    m[0xC2]=88;hold(n,['up'],40);assert.equal(slots(m,2).length,2);assert.equal(m[0xC0],1);
});

realTest('jumping cancels installation and airborne players cannot preview or install',()=>{
    const n=start(),m=n.cpu.mem;hold(n,['up'],15);const s=m[RemoteBomb.RAM.inventory];
    hold(n,['jump']);assert.equal(m[0x55E+s],0);assert.equal(m[0x415+s],0);
    release(n);m[0x700+8*16+1]=5;m[0x700+10*16+1]=0;
    m[0xC2]=56;m[0x41E]=152;m[0xC0]=2;m[0xC7]=0xFE;m[0xC8]=0;
    hold(n,['up']);assert.equal(slots(m,3).length,0);assert.equal(m[0x55E+s],0);assert.equal(m[0x415+s],0);
});

realTest('FIFO detonation shares native explosion slots without consuming normal bombs',()=>{
    const n=start(),m=n.cpu.mem;
    hold(n,['up'],60);release(n);hold(n,['down'],60);release(n);
    let placed=slots(m,3);assert.equal(placed.length,2);
    const first=placed.find(s=>m[0x526+s]===1),second=placed.find(s=>m[0x526+s]===2);
    m[0xCE]=5;m[0xC2]=152;
    hold(n,['up','attack']);
    assert.equal(m[0x4FE+first],0);assert.equal(m[0x526+second],1);assert.equal(m[0xCE],5);
    hold(n,['up','attack'],8);assert.equal(slots(m,3).length,1);
    assert.ok(m[0x4A8]>=10||m[0x4A9]>=10);
    for(let i=0;i<100;i++)n.frame();
    assert.equal(tile(m,3,10),0,'native explosion destroys ceiling cell');
});

realTest('busy explosion slots reject detonation without changing the queue',()=>{
    const n=start(),m=n.cpu.mem;
    hold(n,['up'],60);release(n); const s=slots(m,3)[0];
    m[0x4A8]=1;m[0x4A9]=1;m[0xC2]=152;hold(n,['up','attack']);
    assert.equal(m[0x4FE+s],14);assert.equal(m[0x526+s],1);
});

realTest('detonation cancels an unfinished preview and takes priority while attack is held',()=>{
    const n=start(),m=n.cpu.mem;hold(n,['down'],60);release(n);
    hold(n,['up'],12);const s=m[RemoteBomb.RAM.inventory];assert.equal(m[0x55E+s],12);
    hold(n,['attack']);assert.equal(slots(m,3).length,0);assert.equal(m[0x55E+s],0);
    assert.equal(m[0x415+s],0);assert.equal(slots(m,2).length,2);
    hold(n,['up','attack'],12);assert.equal(m[0x55E+s],0);
});

realTest('pause freezes an unfinished installation timer',()=>{
    const n=start(),m=n.cpu.mem;hold(n,['up'],12);const s=m[RemoteBomb.RAM.inventory];
    n.buttonDown(1,jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1,jsnes.Controller.BUTTON_START);n.frame();
    const ticks=m[0x55E+s];assert.equal(m[0x32],1);assert.ok(ticks>0&&ticks<60);
    for(let i=0;i<50;i++)n.frame();assert.equal(m[0x55E+s],ticks);assert.equal(slots(m,3).length,0);
});

realTest('ordinary down-attack bombs remain available while carrying remote charges',()=>{
    const n=start(),m=n.cpu.mem;m[0xCE]=2;
    hold(n,['down','attack']);
    assert.equal(m[0xCE],1);assert.equal(slots(m,2).length,3);
    assert.ok(m[0x4A8]>0||m[0x4A9]>0);
});

realTest('uncollected remote pickups do not take over ordinary jump controls',()=>{
    const n=start(),m=n.cpu.mem;
    for(const s of slots(m)) {m[0x506+s]=1;m[0x516+s]=200;}
    m[0xC2]=88;hold(n,['up','jump']);
    assert.equal(slots(m,2).length,0);assert.equal(slots(m,3).length,0);
    assert.equal(m[0xC0],2);
});

realTest('wide-page installation keeps full coordinates and only the FIFO head animates',()=>{
    const n=start({wide:true,camera:true}),m=n.cpu.mem;
    m[0xC1]=1;m[0xC2]=56;
    hold(n,['down'],60);release(n);
    m[0xC2]=88;hold(n,['down'],60);release(n);
    const placed=slots(m,3),first=placed.find(s=>m[0x526+s]===1),second=placed.find(s=>m[0x526+s]===2);
    assert.equal(m[0x536+first],19);assert.equal(m[0x50E+first],1);
    assert.equal(m[0x536+second],21);
    const poses=new Set(), renderedTiles=new Set();
    assert.deepEqual(Array.from(n.ppu.vramMem.slice(0x480,0x4E0)),Array.from(RemoteBomb.patterns()));
    for(let i=0;i<70;i++) {
        n.frame();poses.add(m[0x415+first]);assert.equal(m[0x415+second],RemoteBomb.META);
        for(let j=0;j<64;j++) {
            const [y,t,attribute]=n.ppu.spriteMem.slice(j*4,j*4+4);
            if(y<240) assert.notEqual(t,0x4E,'installed TNT must never draw the relocated smoke column');
            if(y<240&&[0x48,0x4A,0x4C].includes(t)) {
                renderedTiles.add(t);assert.equal(attribute&0xC0,0,'native asymmetric body is not mirrored');
            }
        }
    }
    assert.deepEqual([...poses].sort(),[RemoteBomb.META,RemoteBomb.META+1]);
    assert.deepEqual([...renderedTiles].sort(),[0x48,0x4A,0x4C],
        'both indicator colours reach OAM with one shared left column');
    const oam=Array.from({length:64},(_,i)=>n.ppu.spriteMem.slice(i*4,i*4+4))
        .filter(([y,t])=>y<240&&[0x48,0x4A,0x4C].includes(t));
    assert.equal(oam.length,4,'two hardware sprites per installed charge, no frame overlay');
    assert.equal(m[0x433+first],12*16+8,'installed world anchor stays at the cell centre');
    assert.equal(m[0x546+first],12,'attachment remains on the original floor row');
    for(const [y] of oam)assert.equal(y,12*16+7,'sprite drawing returns to its original position');
});

realTest('pause settings restore remote graphics and preserve the queue and inventory',()=>{
    const n=start({camera:true}),m=n.cpu.mem;
    hold(n,['up'],60);release(n);
    const s=slots(m,3)[0],before=Array.from(n.ppu.vramMem.slice(0x480,0x500));
    n.buttonDown(1,jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1,jsnes.Controller.BUTTON_START);n.frame();
    const {openSettings,backToMap}=require('../helpers/pause-settings.cjs');
    openSettings(n);backToMap(n);
    n.buttonDown(1,jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1,jsnes.Controller.BUTTON_START);
    for(let i=0;i<90;i++)n.frame();
    assert.equal(m[0x32],0);assert.equal(slots(m,2).length,2);assert.equal(m[0x526+s],1);
    assert.deepEqual(Array.from(n.ppu.vramMem.slice(0x480,0x500)),before);
});

realTest('export follows later edits to the ground bomb palette without changing the source',()=>{
    const p=new Project();p.loadROM(original);p.romData=Uint8Array.from(p.romData);
    const at=(p.romData[0x564D]|p.romData[0x564E]<<8)-0x8000+16;
    const group=p.romData[0x3FF6]&3;
    p.romData.set([0x12,0x30,0x0F],at+group*4+1);
    const before=p.romData.slice(),rom=p.getROMData();
    assert.deepEqual(Array.from(rom.slice(at+0x18000+25,at+0x18000+28)),[0x12,0x30,0x0F]);
    assert.deepEqual(p.romData,before);
});

realTest('all scenes compile with the remote art and both camera modes',()=>{
    for(let scene=0;scene<12;scene++)for(const camera of [false,true])assert.equal(stage({scene,camera,wide:scene===7||scene===8}).length,0x20010);
});

realTest('destroying a host removes its charge and closes FIFO gaps without detonating',()=>{
    const n=start(),m=n.cpu.mem;
    hold(n,['up'],60);release(n);const first=slots(m,3)[0];
    hold(n,['down'],60);release(n);const second=slots(m,3).find(s=>s!==first);
    setTile(m,3,10,0);n.frame();
    assert.equal(m[0x4FE+first],0);assert.equal(m[0x415+first],0);
    assert.equal(m[0x526+second],1);assert.equal(slots(m,2).length,1,'no refund');
    assert.deepEqual(m.slice(0x4A8,0x4AA),[0,0],'removal does not explode');
    hold(n,['up','attack']);assert.equal(slots(m,3).length,0,'next charge is now detonatable');
});

realTest('a native punch removes an installed charge in the same physics update',()=>{
    const n=start(),m=n.cpu.mem;setTile(m,3,10,9);
    hold(n,['up'],60);release(n);const s=slots(m,3)[0];
    setTile(m,2,11,5);m[0xC2]=43;m[0x41E]=168;m[0xC0]=1;
    n.buttonDown(1,jsnes.Controller.BUTTON_RIGHT);n.frame();n.buttonUp(1,jsnes.Controller.BUTTON_RIGHT);n.frame();
    hold(n,['attack']);
    assert.equal(tile(m,3,10),0,'native punch destroyed the brick');
    assert.equal(m[0x4FE+s],0);assert.equal(m[0x415+s],0);
});

for(const wide of [false,true]) realTest(`installed Tile 8 charges follow half-row falls, landing and a second fall: wide=${wide}`,()=>{
    const n=start({wide,camera:wide}),m=n.cpu.mem,x=wide?19:3;
    if(wide){m[0xC1]=1;m[0xC2]=56;setTile(m,x,10,8);}else setTile(m,x,10,8);
    hold(n,['up'],60);release(n);const s=slots(m,3)[0];assert.notEqual(s,undefined);
    m[0xC2]=88; // Keep the player clear of the falling host.
    const register=(row)=>{m[0x4C0]=255;m[0x4CA]=8;m[0x4D4]=x*2;m[0x4DE]=row*2;m[0x4E8]=0;};
    register(10);const positions=new Set();
    for(let i=0;i<50;i++){
        n.frame();assert.equal(m[0x4FE+s],14);
        assert.equal(m[0x433+s],m[0x4DE]*8+8,`same-frame host position ${i}`);
        assert.equal(m[0x50E+s],wide?1:0);positions.add(m[0x433+s]);
    }
    assert.ok(positions.has(176),'follows the intermediate 8px step');
    assert.equal(tile(m,x,11),8);assert.equal(m[0x433+s],184);
    assert.equal(m[0x546+s],11);assert.equal(m[0x56E+s],0,'landed host returns to map tracking');
    setTile(m,x,12,0);register(11);
    for(let i=0;i<60;i++)n.frame();
    assert.equal(m[0x4FE+s],0,'falling out of the level removes the attached charge');
    assert.equal(m[0x415+s],0);
});

realTest('a landed charge is removed with its new host cell and cannot follow a recycled fall slot',()=>{
    const n=start(),m=n.cpu.mem;setTile(m,3,10,8);hold(n,['up'],60);release(n);
    const s=slots(m,3)[0];m[0xC2]=88;
    m[0x4C0]=255;m[0x4CA]=8;m[0x4D4]=6;m[0x4DE]=20;m[0x4E8]=0;
    for(let i=0;i<50;i++)n.frame();assert.equal(m[0x433+s],184);
    setTile(m,3,11,0);m[0x4C0]=1;m[0x4D4]=10;m[0x4DE]=10;
    n.frame();assert.equal(m[0x4FE+s],0);
});

module.exports={stage,start,hold,release,slots,tile};

