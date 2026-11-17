const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');
const {Project, LevelCodec, Penguin, Coordinates, BirdFish} =
    require('../helpers/source.cjs').load('Project LevelCodec Penguin Coordinates BirdFish');
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, body) => test(name, {skip: !original}, body);
const frames = (n, count) => {for (let i=0;i<count;i++) n.frame();};
const slot = m => m.slice(0x4FE,0x506).indexOf(15);
const xAt = (m,s) => m[0x516+s]+256*m[0x50E+s];
function putTile(m,x,y,tile) {
    const at=0x700+y*16+(x>>1), shift=x&1?0:4;
    m[at]=(m[at]&~(15<<shift))|(tile<<shift);
}
function start({wide=false, portals=false, camera=true}={}) {
    const p=new Project();p.loadROM(original);p.gameConfig.disableTimer=true;p.gameConfig.cameraFollow=camera;
    const map=Array.from({length:14},()=>Array(wide?32:16).fill(0));map[12].fill(5);map[1][2]=15;
    const enemies=portals?[{enemyId:13,x:6,y:11},{enemyId:13,x:24,y:7}]:[];
    if(portals)map[8][24]=5;
    enemies.push({enemyId:15,x:wide&&!portals?24:8,y:11});
    const d=LevelCodec.fromLevelEditorToROMData({background:wide?16:0,map,player:{x:2,y:11},door:{x:14,y:10},enemies},wide);
    p.levels[0].data=d.mapData;p.levels[0].monsterData=d.monsterData;p.levelCount=1;
    const n=new jsnes.NES({onFrame(){},emulateSound:false});n.loadROM(Buffer.from(p.getROMData()).toString('binary'));
    frames(n,160);n.buttonDown(1,jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1,jsnes.Controller.BUTTON_START);
    for(let i=0;i<750;i++) {
        n.frame();const m=n.cpu.mem,s=slot(m);
        if(m[0x30]===12&&m[0x56]===3&&!(m[0x2A]&128)&&s>=0&&m[0x506+s]===1)return n;
    }
    assert.fail('live penguin did not spawn');
}
function clearHazards(m) {
    m[0x8B]=m[0x8E]=0;m.fill(0,0x4F2,0x4F5);m.fill(0,0x4A8,0x4AC);
}
function respawn(n,s,{birthPage,birth,checkTumble=false}) {
    const m=n.cpu.mem,flips=new Set();let waiting=false;
    for(let i=0;i<180;i++) {
        if(m[0x506+s]===11)flips.add(m[0x46F+s]&0xC0);
        if(m[0x506+s]===13){waiting=true;break;}
        n.frame();
    }
    assert.ok(waiting,'defeat reaches the shared countdown');
    if(checkTumble)assert.equal(flips.size,4,'all native tumble flips are retained');
    assert.ok(m[0x57E+s]>=199);
    m[0xC1]=birthPage;m[0xC2]=32;
    const timers=new Set(),smoke=new Set();let live=false;
    for(let i=0;i<950;i++) {
        n.frame();timers.add(m[0x57E+s]);
        assert.equal(m[0x4FE+s],15);assert.equal(m[0x576+s],birth);
        assert.equal(m[Coordinates.COORDINATE_RAM.enemySpawnPages+s],birthPage);
        if(m[0x506+s]===0)smoke.add(m[0x415+s]);
        if(m[0x506+s]===1){live=true;break;}
    }
    assert.ok(live,'respawns after the complete delay and smoke');
    assert.ok(timers.has(100)&&timers.has(1));
    assert.ok(smoke.has(8)&&smoke.has(9),'uses native smoke metasprites: '+[...smoke]);
    assert.equal(m[0x50E+s],birthPage);
    assert.ok(Math.abs(m[0x516+s]-((birth&0xF0)|6))<=1);
    assert.equal(m[0x433+s],(birth&15)*16+8);
    assert.equal(m[0x57E+s],0);assert.equal(m[0x53E+s],0);assert.equal(m[0x54E+s]&128,0);
    assert.ok([Penguin.META+1,Penguin.META+2].includes(m[0x415+s]));
}

realTest('real player headbutts kill penguins with a native tumble and full respawn in both map widths',()=>{
    for(const wide of [false,true]) {
        const n=start({wide}),m=n.cpu.mem,s=slot(m);
        const birth=m[0x576+s],birthPage=m[Coordinates.COORDINATE_RAM.enemySpawnPages+s];
        m[0xC1]=0;m[0xC2]=64;m[0xCB]=4;m[0xC0]=1;
        m[0x50E+s]=0;m[0x516+s]=78;m[0x433+s]=m[0x41E];m[0x556+s]=4;
        n.buttonDown(1,jsnes.Controller.BUTTON_B);n.frame();n.buttonUp(1,jsnes.Controller.BUTTON_B);
        assert.equal(m[0x506+s],11,'native B input starts defeat');
        assert.ok(m[0x54E+s]&128);assert.equal(m[0xC0],1,'neutral contact never damages the player');
        respawn(n,s,{birth,birthPage,checkTumble:true});
    }
});

const hazards=[
    ['thrown stone',11,(m,x,y,page)=>{m[0x8B]=2;m[0x8E]=2;m[0x8C]=page;m[0x8D]=x;m[0x43B]=y;}],
    ['falling stone',10,(m,x,y,page)=>{m[0x8B]=3;m[0x8E]=2;m[0x8C]=page;m[0x8D]=x;m[0x43B]=y;}],
    ...[7,10,13].map(tile=>['falling tile '+tile,10,(m,x,y,page)=>{
        m[0x4F2]=tile;m[0x4F5]=page;m[0x4F8]=x;m[0x430]=y;m[0x4FB]=3;
    }]),
    ['explosion',11,(m,x,y,page)=>{m[0x4A8]=11;m[0x4AC]=page;m[0x4B0]=x;m[0x42B]=y+8;m[0x4B8]=m[0x4BC]=0;}],
    ['solid crush',10,(m,x,y,page)=>putTile(m,(x>>4)+page*16,y>>4,5)]
];
realTest('stones, falling tiles, explosions and solid crush defeat penguins before ice or passenger updates',()=>{
    for(const wide of [false,true]) for(const [name,state,place] of hazards) {
        const n=start({wide}),m=n.cpu.mem,s=slot(m),page=wide?1:0;
        const birth=m[0x576+s],birthPage=m[Coordinates.COORDINATE_RAM.enemySpawnPages+s];
        m[0x516+s]=136;m[0x50E+s]=page;m[0x433+s]=184;m[0x57E+s]=119;
        m[0x53E+s]=1;clearHazards(m);
        const map=m.slice(0x700,0x800);place(m,136,184,page);n.frame();
        assert.equal(m[0x506+s],state,name);assert.ok(m[0x54E+s]&128,name);
        clearHazards(m);m.splice(0x700,256,...map);
        respawn(n,s,{birth,birthPage});
    }
});

realTest('defeated penguins cannot support riders or keep an almost-complete ice build',()=>{
    const n=start(),m=n.cpu.mem,s=slot(m);
    m[0x516+s]=88;m[0x556+s]=4;m[0x57E+s]=119;putTile(m,6,12,0);
    m[0xC2]=88;m[0x41E]=168;m[0xC0]=1;m[0x53E+s]=1;
    hazards[4][2](m,88,184,0);n.frame();clearHazards(m);
    assert.equal(m[0x506+s],10);frames(n,30);
    assert.equal(m[0x706+12*16]>>4,5); // Adjacent floor remains intact.
    assert.equal(m[0x703+12*16]>>4,0,'no ice appears after the carrier dies');
    assert.notEqual(m[0x41E],168,'the rider is released');
    const {findRider}=BirdFish.addBirdFishPlatform(new Uint8Array(0x20010));
    m[0xC2]=m[0x516+s];m[0xC1]=m[0x50E+s];m[0x53E+s]=1;
    m.splice(0x6000,3,0x20,findRider&255,findRider>>8);
    n.cpu.REG_PC=0x5FFF;n.cpu.REG_SP=0x1FF;n.cpu.irqRequested=false;
    for(let i=0;i<1000&&n.cpu.REG_PC!==0x6002;i++)n.cpu.emulate();
    assert.equal(n.cpu.REG_PC,0x6002);assert.equal(n.cpu.F_CARRY,0,'dead velocity bytes cannot masquerade as a rider');
});

realTest('a rock pushed by the player can crush a penguin against a wall',()=>{
    const n=start(),m=n.cpu.mem,s=slot(m);
    m[0xC2]=54;m[0xC1]=0;m[0x41E]=184;m[0xC0]=1;m[0xCB]=4;
    m[0x516+s]=88;m[0x50E+s]=0;m[0x433+s]=184;m[0x556+s]=4;
    putTile(m,4,11,10);putTile(m,6,11,5);
    n.buttonDown(1,jsnes.Controller.BUTTON_RIGHT);
    let crushed=false;
    for(let i=0;i<180;i++) {n.frame();if(m[0x506+s]>=10){crushed=true;break;}}
    n.buttonUp(1,jsnes.Controller.BUTTON_RIGHT);
    assert.ok(crushed,'native pushed-rock physics traps and defeats the penguin');
    assert.equal(m[0x506+s],10);assert.ok(m[0x54E+s]&128);
});

realTest('a penguin crosses a portal, remains vulnerable, and respawns at its original birthplace',()=>{
    const n=start({wide:true,portals:true}),m=n.cpu.mem,s=slot(m);
    const birth=m[0x576+s],birthPage=m[Coordinates.COORDINATE_RAM.enemySpawnPages+s];
    m[0x516+s]=104;m[0x50E+s]=0;m[0x433+s]=184;m[0x57E+s]=85;
    for(let i=0;i<10&&m[0x50E+s]===0;i++)n.frame();
    assert.equal(m[0x50E+s],1);assert.ok(Math.abs(xAt(m,s)-392)<=1);
    assert.equal(m[0x433+s],120);assert.equal(m[0x506+s],1);
    assert.equal(m[0x53E+s],0);assert.equal(m[0x57E+s],0);
    hazards[1][2](m,m[0x516+s],120,1);n.frame();clearHazards(m);
    assert.equal(m[0x506+s],10);
    respawn(n,s,{birth,birthPage});
});

realTest('Tile 13 impact and falling out of the map use safe defeat rather than type-indexed AI',()=>{
    for(const entry of [0xB374,null]) {
        const n=start(),m=n.cpu.mem,s=slot(m);
        if(entry) {
            const cpuState=n.cpu.toJSON();
            m.splice(0x6000,3,0x20,entry&255,entry>>8);n.cpu.REG_PC=0x5FFF;n.cpu.REG_SP=0x1FF;n.cpu.irqRequested=false;
            for(let i=0;i<3000&&n.cpu.REG_PC!==0x6002;i++)n.cpu.emulate();
            assert.equal(m[0x506+s],12);
            // Restore the game's instruction/stack context, retaining the hit.
            n.cpu.fromJSON({...cpuState,mem:m});
        } else m[0x433+s]=232;
        n.frame();assert.ok(m[0x506+s]>=10&&m[0x506+s]!==12);
        assert.equal(m[0x4FE+s],15);
    }
});

realTest('pause freezes both the death countdown and the reappearance smoke',()=>{
    const n=start(),m=n.cpu.mem,s=slot(m);
    hazards[1][2](m,m[0x516+s],m[0x433+s],m[0x50E+s]);n.frame();clearHazards(m);
    for(const state of [13,0]) {
        for(let i=0;i<1000&&m[0x506+s]!==state;i++)n.frame();
        assert.equal(m[0x506+s],state);
        n.buttonDown(1,jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1,jsnes.Controller.BUTTON_START);
        const snapshot=()=>[0x506,0x566,0x55E,0x57E,0x516,0x433].map(a=>m[a+s]);
        const before=snapshot();frames(n,60);assert.deepEqual(snapshot(),before);
        n.buttonDown(1,jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1,jsnes.Controller.BUTTON_START);
        for(let i=0;i<120&&(m[0x32]||(m[0x2A]&128));i++)n.frame();
        assert.equal(m[0x32],0,'pause return restores graphics before gameplay');
        frames(n,10);assert.notDeepEqual(snapshot(),before);
    }
});
