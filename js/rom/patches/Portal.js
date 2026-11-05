class Portal {
    /**
     * Enemy 13: paired automatic portals with background/overlay rendering.
     * Clu Clu Land's four black-hole frames use reserved background-table
     * CHR plus two contracted changeover poses. Background cells and the
     * two-sprite occlusion overlay use native palettes and group numerals.
     * No solid tile.
     * $FB00-$FC7F is split off from the unused end of the bird motion area.
     */

    static PORTAL_RAM = Object.freeze({group: 0x5E6, bankActive: 0x5EE, mode: 0x5EF,
        command: 0x5F0, owner: 0x5F1, destination: 0x5F2,
        sourceX: 0x5F3, sourceY: 0x5F4, targetX: 0x5F5, targetY: 0x5F6,
        count: 0x5F7, role: 0x526, partner: 0x536, clockLow: 0x546,
        clockHigh: 0x56E, cooldown: 0x57E, overlay: 0x52E,
        visual: 0x53E, backgroundFrame: 0x556, drawCursor: 0x5F8, panTicks: 0x5F9,
        panLow: 0x5FA, panHigh: 0x5FB});

    static addSpritePortalPreview(romData, priorRenderer = null) {
        const transport = Portal.addPortalTransport(romData);
        const ram = Portal.PORTAL_RAM;
        const base = 0xFB00, limit = 0xFBEF; // $FBEF–$FBFF belongs to the scene compiler.
        const file = RomLayout.programOffset;
        if (romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved portal area is occupied');
        // Chain the existing bird/fish metasprite extension, without taking
        // over its frames or any native metasprite definitions.
        const {bytes, labels, emit, label, absolute, branch, resolve} = Asm6502.block(base, limit);
        label('dispatch');
        emit(0xC9, 0x0D); branch(0xF0, 'portalTick');
        absolute(0x4C, 0xFD00);
        label('portalTick'); absolute(0x20, 'tick'); absolute(0x4C, 0xA9B3);

        label('initialize');
        emit(0xBD, 0xFE, 0x04, 0xC9, 0x0D); branch(0xF0, 'initializePortal');
        absolute(0x4C, 0xBCFE);
        label('initializePortal');
        emit(0xA9, 0x00); absolute(0x20, 'transport');
        absolute(0x20, 'draw'); absolute(0x4C, 0xBD39);

        // Pair state, reverse animation, and validated transport live in bank 1.
        label('tick');
        emit(0xA9, 0x01); absolute(0x20, 'transport');
        label('draw');
        // Occupied cells keep their transparent outline even during the
        // departure cooldown, so a newly arrived rock cannot be concealed.
        absolute(0xBD, ram.visual); emit(0xC9, 6); branch(0xF0, 'ordinaryDraw');
        // Only a successful departure starts the 30-tick pair lock. Use
        // its first 16 ticks to show three closing poses from native defeat.
        absolute(0xBD, ram.role); branch(0xD0, 'ordinaryDraw');
        absolute(0xBD, ram.cooldown); emit(0xC9, 15); branch(0x90, 'ordinaryDraw');
        emit(0xA0, 13, 0xC9, 19); branch(0x90, 'departurePose'); emit(0x88, 0xC9, 27);
        branch(0x90, 'departurePose'); emit(0x88);
        label('departurePose'); absolute(0xB9, 0xC379); absolute(0x4C, 'projectMeta');
        label('ordinaryDraw'); absolute(0xBD, ram.overlay); branch(0xD0, 'drawOverlay');
        emit(0x9D, 0x15, 0x04, 0x60);
        label('drawOverlay');
        absolute(0xBD, ram.group); emit(0x85, 0, 0x0A, 0x0A, 0x0A, 0x38, 0xE5, 0, 0x18);
        absolute(0x7D, ram.visual);
        emit(0x18, 0x69, 0x2F); label('projectMeta'); emit(0x9D, 0x15, 0x04);
        absolute(0x4C, 0xAE54); // Native camera projection and off-screen clipping.

        label('render');
        emit(0xC9, 0x2F); branch(0x90, 'previousRender');
        emit(0xC9, 0x4B); branch(0xB0, 'previousRender');
        // Odd tile IDs select $1000 CHR in 8x16 mode. Each pair is now
        // top/bottom of a column: $C1/$C3, $C5/$C7, $C9/$CB, $CD/$CF.
        emit(0x38, 0xE9, 0x2F, 0xA8);
        absolute(0xB9, transport.leftTiles); emit(0x85, 0x10);
        absolute(0xB9, transport.rightTiles); emit(0x85, 0x11,
            0xA9, 0x00, 0x85, 0x12, 0x85, 0x13, 0x85, 0x0F);
        absolute(0x4C, 0x8951); // Native two-column OAM writer (incl. edge clipping).
        label('previousRender');
        if (priorRenderer !== null) absolute(0x4C, priorRenderer);
        else {
            emit(0x0A); branch(0xB0, 'largeRender');
            absolute(0x4C, 0x8935);
            label('largeRender'); absolute(0x4C, 0x8991);
        }

        label('camera');
        absolute(0xAD, ram.panTicks); branch(0xD0, 'panCamera');
        absolute(0x4C, 0x9B38);
        label('panCamera');
        // Get the target from the installed camera (NORMAL/LOOP, narrow/wide).
        absolute(0x20, 0x9B38); emit(0xA9, 2); // fall through to bank 1

        label('transport');
        absolute(0x8D, ram.mode); absolute(0x8E, ram.owner);
        // The fixed-bank NMI guard checks bankActive. Leave PPUCTRL alone:
        // $FF can already select the NEXT frame's camera page during rendering.
        emit(0xA9, 0x01); absolute(0x8D, ram.bankActive); emit(0x8D, 0x00, 0x80);
        absolute(0x20, transport.start);
        emit(0xA9, 0x00, 0x8D, 0x00, 0x80); absolute(0x8D, ram.bankActive);
        absolute(0xAD, ram.command); branch(0xF0, 'transportDone');
        absolute(0x20, transport.paint);
        absolute(0xAE, ram.destination); absolute(0x20, 'draw');
        label('transportDone'); absolute(0xAE, ram.owner); emit(0x60);

        // Capture bits 4/5 before the native loader masks the type to 0..15.
        label('loadGroup'); emit(0x48, 0x29, 0x30, 0x4A, 0x4A, 0x4A, 0x4A);
        absolute(0x9D, ram.group); emit(0x68, 0x29, 0x0F, 0x9D, 0xFE, 0x04, 0x60);

        resolve();
        Asm6502.writeBytes(romData, file(base), bytes);
        for (const [hook, name] of [[0xA978, 'dispatch'], [0xBCFB, 'initialize'], [0x8932, 'render']]) {
            const target = labels.get(name);
            Asm6502.writeBytes(romData, file(hook), [0x4C, target & 255, target >> 8]);
        }
        Asm6502.writeBytes(romData, file(0xADDB), [0x20, labels.get('loadGroup') & 255, labels.get('loadGroup') >> 8, 0xEA, 0xEA]);
        Asm6502.writeBytes(romData, file(0x9420), [0x20, labels.get('camera') & 255, labels.get('camera') >> 8]);
        return {start: base, end: base + bytes.length, labels: Object.fromEntries(labels), transport};
    }

    /** Bank-1 portal worker: no bank-0 calls and no direct PPU access. */
    static addPortalTransport(romData) {
        const r = Portal.PORTAL_RAM;
        const {labels, blocks: parts, section, emit, label, absolute: abs, branch, resolve} = Asm6502.program();
        const org = (base, limit, file) => { section(base, limit).file = file; };
        // Long conditional jumps keep the validation exits readable.
        const jumpIf = (op, target) => { emit(op ^ 0x20, 3); abs(0x4C, target); };
        const lda = address => abs(0xAD, address), sta = address => abs(0x8D, address);
        const lx = address => abs(0xBD, address), sx = address => abs(0x9D, address);
        const ly = address => abs(0xB9, address);
        const jsr = target => abs(0x20, target);

        // Bank 1 follows the fonts; the settings page starts at $B300.
        org(0xA900, 0xB300, 0x6910);
        label('entry');
        emit(0xA9, 0); sta(r.command); lda(r.mode); branch(0xF0, 'initialize');
        emit(0xC9, 2); jumpIf(0xF0, 'panStep');
        jsr('tick'); abs(0x4C, 'appearance');
        label('initialize');
        emit(0xA9, 0x00, 0x9D, 0x5E, 0x05, 0x9D, 0x66, 0x05,
            0xA9, 0x80, 0x9D, 0x4E, 0x05, // No contact damage, rescue, or native AI.
            0xA9, 0x01, 0x9D, 0x06, 0x05,
            // Native grid anchors include the scene's eight-pixel Y offset.
            0xBD, 0x76, 0x05, 0x29, 0xF0, 0x09, 0x08, 0x9D, 0x16, 0x05,
            0xBD, 0x76, 0x05, 0x29, 0x0F, 0x0A, 0x0A, 0x0A, 0x0A, 0x09, 0x08, 0x9D, 0x33, 0x04);
        emit(0xA9, 0xFF); sx(r.partner); emit(0xA9, 0); sta(r.count);
        lx(r.group); emit(0x85, 0x00, 0xA0, 0);
        label('findPartner');
        emit(0x98); abs(0xCD, r.owner); branch(0xF0, 'nextPartner');
        ly(0x4FE); emit(0xC9, 13); branch(0xD0, 'nextPartner');
        ly(r.group); emit(0xC5, 0); branch(0xD0, 'nextPartner');
        emit(0x98); sx(r.partner); abs(0xEE, r.count);
        label('nextPartner'); emit(0xC8, 0xC0, 8); branch(0xD0, 'findPartner');
        lda(r.count); emit(0xC9, 1); branch(0xF0, 'validPair');
        emit(0xA9, 0xFF); sx(r.partner);
        label('validPair');
        // Records load from slot 7 downward; the first placed portal starts
        // as entry, regardless of its legacy facing bit.
        emit(0x8A); abs(0xDD, r.partner); emit(0xA9, 0); branch(0xB0, 'initialRole'); emit(0xA9, 1);
        label('initialRole'); sx(r.role);
        emit(0xA9, 44); sx(r.clockLow); emit(0xA9, 1); sx(r.clockHigh);
        emit(0xA9, 0); sx(r.cooldown);
        emit(0xA5, 0x3E, 0x0A, 0x0A, 0x85, 0); lx(r.group); emit(0x05, 0, 0xA8);
        ly('spritePalettes'); sx(0x46F);
        emit(0xA9, 1); sx(r.overlay); emit(0xA9, 0xFF); sx(r.backgroundFrame);
        emit(0x8A); sta(r.drawCursor); abs(0x4C, 'appearance');

        label('tick');
        lx(r.clockLow); branch(0xD0, 'clockLow'); abs(0xDE, r.clockHigh);
        label('clockLow'); abs(0xDE, r.clockLow); lx(r.clockLow); abs(0x1D, r.clockHigh);
        branch(0xD0, 'animate');
        emit(0xA9, 44); sx(r.clockLow); emit(0xA9, 1); sx(r.clockHigh);
        lx(r.role); emit(0x49, 1); sx(r.role);
        emit(0xA9, 0); sx(0x55E);
        label('animate');
        emit(0xFE, 0x66, 0x05, 0xBD, 0x66, 0x05, 0x29, 7, 0x9D, 0x66, 0x05);
        branch(0xD0, 'cooldown'); lx(r.role); branch(0xF0, 'forward');
        emit(0xBD, 0x5E, 0x05, 0x38, 0xE9, 1); abs(0x4C, 'phase');
        label('forward'); emit(0xBD, 0x5E, 0x05, 0x18, 0x69, 1);
        label('phase'); emit(0x29, 3, 0x9D, 0x5E, 0x05);
        label('cooldown'); lx(r.cooldown); branch(0xF0, 'ready'); abs(0xDE, r.cooldown); emit(0x60);
        label('ready');
        lx(r.clockHigh); branch(0xD0, 'active');
        lx(r.clockLow); emit(0xC9, 61); jumpIf(0x90, 'done');
        label('active');
        lx(r.partner); emit(0xC9, 8); jumpIf(0xB0, 'done'); sta(r.destination);
        lx(r.role); jumpIf(0xD0, 'done');
        emit(0xA5, 0x56, 0xC9, 3); jumpIf(0xD0, 'done');
        // Scratch $04/$0A hold a candidate's kind/slot only during this scan.
        emit(0xA9, 0, 0x85, 4);
        jsr('coordinates'); emit(0xA5, 0); sta(r.sourceX); emit(0xA5, 1); sta(r.sourceY);
        emit(0xC9, 14); jumpIf(0xB0, 'done');
        abs(0xAE, r.destination); jsr('coordinates'); emit(0xA5, 0); sta(r.targetX); emit(0xA5, 1); sta(r.targetY);
        emit(0xC9, 14); jumpIf(0xB0, 'done');
        jsr('getTile'); jumpIf(0xD0, 'done');
        // Tile objects in flight have left map RAM. Defer when their cached
        // grid cell overlaps either endpoint. $FF is a stationary support
        // watcher, not a falling object; it is retired when its stone moves.
        emit(0xA0, 9);
        label('fallingCheck'); ly(0x4C0); branch(0xF0, 'nextFalling');
        emit(0xC9, 0xFF); branch(0xF0, 'nextFalling');
        ly(0x4D4); emit(0x4A); abs(0xCD, r.targetX); branch(0xD0, 'checkSourceFall');
        lda(r.targetY); emit(0x0A, 0x38); abs(0xF9, 0x4DE);
        emit(0x18, 0x69, 1, 0xC9, 3); jumpIf(0x90, 'done');
        label('checkSourceFall'); ly(0x4D4); emit(0x4A); abs(0xCD, r.sourceX); branch(0xD0, 'nextFalling');
        lda(r.sourceY); emit(0x0A); abs(0xD9, 0x4DE); branch(0xD0, 'nextFalling');
        // At a full-cell boundary a falling background object has exactly
        // one cell to erase. Its countdown owns the tile until state 1.
        ly(0x4C0); emit(0xC9, 1); jumpIf(0xD0, 'done');
        emit(0xA9, 1, 0x85, 4, 0x84, 0x0A);
        label('nextFalling'); emit(0x88); branch(0x10, 'fallingCheck');
        // Scan all independent object pools before committing any transfer.
        const point = (x, page, y) => {
            ly(x); emit(0x85, 0); ly(page); emit(0x85, 1); ly(y); emit(0x85, 2);
        };
        const candidate = kind => {
            jsr('atSource'); emit(0xF0, 6, 0xA9, kind, 0x85, 4, 0x84, 0x0A);
            jsr('overlap'); jumpIf(0xD0, 'done');
        };
        emit(0xA0, 7);
        label('creatureCheck'); ly(0x4FE); branch(0xF0, 'nextCreature'); emit(0xC9, 13); branch(0xF0, 'nextCreature');
        emit(0xC9, 9); branch(0xD0, 'mobileEnemy');
        // The statue installs two solid map nibbles. Never detach its
        // collision tiles from the fixed background emitter.
        point(0x516, 0x50E, 0x433); jsr('atSource'); jumpIf(0xD0, 'done');
        emit(0xA5, 2, 0x38, 0xE9, 16, 0x85, 2); jsr('atSource'); jumpIf(0xD0, 'done');
        abs(0x4C, 'nextCreature');
        label('mobileEnemy'); ly(0x506); branch(0xF0, 'nextCreature'); emit(0xC9, 10); branch(0xB0, 'nextCreature');
        point(0x516, 0x50E, 0x433); candidate(2);
        label('nextCreature'); emit(0x88); branch(0x10, 'creatureCheck');
        const pools = [
            {name:'loose', kind:3, last:2, active:0x4F2, x:0x4F8, page:0x4F5, y:0x430, screenX:0x44E},
            {name:'missile', kind:4, last:0, active:0x8B, x:0x8D, page:0x8C, y:0x43B, screenX:0x459},
            {name:'bomb', kind:5, last:1, active:0x4A8, x:0x4B0, page:0x4AC, y:0x42B, screenX:0x449},
        ];
        for (const pool of pools) {
            emit(0xA0, pool.last); label(pool.name + 'Scan');
            ly(pool.active); branch(0xF0, pool.name + 'Next');
            point(pool.x, pool.page, pool.y);
            if (pool.kind === 5) {
                ly(pool.active); emit(0xC9, 11); branch(0x90, 'bombPoint');
                ly(0x4B4); emit(0x38, 0xE9, 8, 0x85, 2); label('bombPoint');
            }
            if (pool.kind === 3) {
                // Armed falling traps still own their original map cell.
                ly(0x4FB); emit(0xC9, 0xFF); branch(0xD0, 'loosePoint');
                jsr('atSource'); jumpIf(0xD0, 'done'); label('loosePoint');
            }
            candidate(pool.kind);
            label(pool.name + 'Next'); emit(0x88); branch(0x10, pool.name + 'Scan');
        }
        emit(0xA5, 0xC0, 0xC9, 3); branch(0xD0, 'sourceCell');
        emit(0xA0, 0); point(0xDE, 0xDD, 0x430); candidate(6);
        label('sourceCell');
        lda(r.sourceX); emit(0x85, 0); lda(r.sourceY); emit(0x85, 1); jsr('getTile');
        branch(0xF0, 'emptySource'); sta(r.count); emit(0xA9, 0, 0x85, 4); abs(0x4C, 'tileCargo');
        label('emptySource'); emit(0xA5, 4); jumpIf(0xD0, 'objectCargo');
        // Players enter automatically once centered in an active entry.
        emit(0xA5, 0x7D); jumpIf(0xD0, 'done');
        emit(0xA5, 0xC0); jumpIf(0xF0, 'done'); // Respawn has not initialized the player yet.
        emit(0xC9, 3); jumpIf(0xB0, 'done');
        abs(0xAE, r.owner);
        // Player center must be within four pixels of the entry's anchor.
        emit(0x38, 0xA5, 0xC2, 0xFD, 0x16, 0x05, 0x85, 0,
            0xA5, 0xC1, 0xFD, 0x0E, 0x05, 0x85, 1,
            0x18, 0xA5, 0, 0x69, 4, 0x85, 0, 0xA5, 1, 0x69, 0, 0x25, 0x3D);
        jumpIf(0xD0, 'done'); emit(0xA5, 0, 0xC9, 9); jumpIf(0xB0, 'done');
        emit(0x38, 0xAD, 0x1E, 0x04, 0xFD, 0x33, 0x04, 0x18, 0x69, 4, 0xC9, 9); jumpIf(0xB0, 'done');
        abs(0xAE, r.destination);
        emit(0xBD, 0x16, 0x05, 0x85, 0xC2, 0xBD, 0x0E, 0x05, 0x85, 0xC1,
            0xBD, 0x33, 0x04, 0x8D, 0x1E, 0x04, 0xA9, 0);
        for (const address of [0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xDC, 0x7D, 0x5B, 0x52, 0xDA, 0xA6, 0xD4]) emit(0x85, address);
        // Native action 0 respawns at the level start; action 1 resumes
        // standing/walking and checks support at the new location.
        emit(0xA9, 1, 0x85, 0xC0);
        // Detach a carrier immediately; other birds keep their own motion.
        emit(0xA0, 7);
        label('detach'); ly(0x4FE); emit(0xC9, 12); branch(0xD0, 'nextDetach');
        emit(0xA9, 0, 0x99, 0x3E, 0x05);
        label('nextDetach'); emit(0x88); branch(0x10, 'detach');
        emit(0xA5, 0xFD); sta(r.panLow); emit(0xA5, 0x9D); sta(r.panHigh);
        // The portal takes over any stage-entry camera transition.
        emit(0xA5, 0x2A, 0x29, 0x7F, 0x85, 0x2A, 0xA9, 16); sta(r.panTicks);
        // Projection for this tick was already built at the entrance. The
        // next native player update projects the arrival against the pan.
        emit(0xA9, 0); sta(0x400); abs(0x4C, 'lock');

        label('objectCargo');
        jsr('playerBlocks'); jumpIf(0xD0, 'done');
        emit(0xA4, 0x0A, 0xA5, 4, 0xC9, 1); branch(0xD0, 'movingCargo');
        ly(0x4CA); sta(r.count); abs(0x4C, 'tileCargo');
        label('movingCargo'); emit(0xC9, 3); branch(0xD0, 'rollingCargo');
        ly(0x4F2); emit(0xC9, 10); branch(0xD0, 'liveCargo');
        // A loose rock's native step moves down before probing support. At
        // an exit it would skip the cell immediately below and overwrite a
        // previous arrival. Reattach it to the map and let tileCargo register
        // native support/falling, just as for a rock entering during a push.
        abs(0x4C, 'stoneCargo');
        label('rollingCargo'); emit(0xC9, 4); branch(0xD0, 'pushedCargo');
        // Headbutted rocks use the singleton pool: states 1/2 roll, 3 falls.
        emit(0xA5, 0x8B, 0xC9, 3); branch(0xD0, 'liveCargo');
        abs(0x4C, 'stoneCargo');
        label('pushedCargo'); emit(0xC9, 6); branch(0xD0, 'liveCargo');
        label('stoneCargo'); emit(0xA9, 10); sta(r.count); abs(0x4C, 'tileCargo');
        label('liveCargo');
        emit(0xA5, 4);
        abs(0xAE, r.destination);
        // These objects have already projected their sprites this tick. Move
        // both world bytes and immediately clip the arrival against the full
        // camera position; copying only screen X wraps an off-screen exit
        // into view until the next native update (four ticks for loose rocks).
        const movePoint = (name, x, page, y, screenX, metasprite) => {
            lx(0x516); abs(0x99, x); emit(0x38, 0xE5, 0xFD); abs(0x99, screenX);
            lx(0x50E); abs(0x99, page); emit(0xE5, 0x9D, 0x25, 0x3D);
            branch(0xF0, name + 'Visible'); emit(0xA9, 0); abs(0x99, metasprite);
            label(name + 'Visible'); lx(0x433); abs(0x99, y);
        };
        for (const pool of pools) {
            emit(0xC9, pool.kind); branch(0xD0, pool.name + 'Other');
            movePoint(pool.name, pool.x, pool.page, pool.y, pool.screenX, pool.screenX - 0x3C);
            if (pool.kind === 5) { emit(0x18, 0x69, 8); abs(0x99, 0x4B4); }
            abs(0x4C, 'lock'); label(pool.name + 'Other');
        }
        // Keep the enemy's live slot, velocity, AI state and respawn record.
        ly(0x4FE);
        for (const type of [3, 7, 8, 10]) { emit(0xC9, type); branch(0xF0, 'tallCargo'); }
        abs(0x4C, 'enemyHeightReady');
        label('tallCargo');
        lda(r.targetX); emit(0x85, 0); lda(r.targetY); jumpIf(0xF0, 'done');
        emit(0x85, 1, 0xC6, 1); jsr('getTile'); jumpIf(0xD0, 'done');
        ly(0x4FE); emit(0xC9, 7); branch(0xD0, 'enemyHeightReady');
        // A 32px boss also needs clearance on either side of its anchor.
        for (const delta of [1, -1]) {
            emit(0xA5, 0x3D, 0x0A, 0x0A, 0x0A, 0x0A, 0x09, 15, 0x85, 3);
            lda(r.targetX); emit(0x18, 0x69, delta & 255, 0x25, 3, 0x85, 0);
            lda(r.targetY); emit(0x85, 1); jsr('getTile'); jumpIf(0xD0, 'done');
            emit(0xC6, 1); jsr('getTile'); jumpIf(0xD0, 'done');
        }
        label('enemyHeightReady'); abs(0xAE, r.destination);
        ly(0x4FE); emit(0xC9, 12); branch(0xD0, 'enemyPosition');
        lx(0x433); abs(0x99, 0x546);
        emit(0xA9, 0);
        for (const address of [0x53E, 0x56E, 0x57E, ...Object.values(BirdFish.BIRD_RAM)]) abs(0x99, address);
        label('enemyPosition');
        movePoint('enemy', 0x516, 0x50E, 0x433, 0x451, 0x415);
        abs(0x4C, 'lock');

        label('tileCargo');
        // Both redraw packets must fit together. At most one pair transfers
        // a stone per empty queue; nothing is removed while the queue is busy.
        emit(0xA5, 0x1E); jumpIf(0xD0, 'done');
        jsr('playerBlocks'); jumpIf(0xD0, 'done');
        emit(0xA4, 0x0A, 0xA5, 4, 0xC9, 1); branch(0xD0, 'checkPush');
        emit(0xA9, 0, 0x99, 0xC0, 4);
        label('checkPush'); emit(0xA5, 4, 0xC9, 6); branch(0xD0, 'watchers');
        emit(0xA9, 1, 0x85, 0xC0, 0xA9, 0, 0x85, 0xDF); sta(0x412);
        label('watchers');
        emit(0xA5, 4, 0xC9, 3); branch(0xD0, 'retireRolling');
        // Retire the loose slot only after the queue/player guards commit.
        emit(0xA9, 0); abs(0x99, 0x4F2); abs(0x99, 0x412);
        label('retireRolling'); emit(0xA5, 4, 0xC9, 4); branch(0xD0, 'scanWatchers');
        emit(0xA9, 0, 0x85, 0x8B); sta(0x41D);
        label('scanWatchers');
        emit(0xA0, 9);
        label('retireWatcher'); ly(0x4C0); emit(0xC9, 0xFF); branch(0xD0, 'nextWatcher');
        ly(0x4D4); emit(0x4A); abs(0xCD, r.sourceX); branch(0xD0, 'nextWatcher');
        ly(0x4DE); emit(0x4A); abs(0xCD, r.sourceY); branch(0xD0, 'nextWatcher');
        emit(0xA9, 0, 0x99, 0xC0, 4);
        label('nextWatcher'); emit(0x88); branch(0x10, 'retireWatcher');
        lda(r.sourceX); emit(0x85, 0); lda(r.sourceY); emit(0x85, 1, 0xA9, 0); jsr('setTile');
        lda(r.targetX); emit(0x85, 0); lda(r.targetY); emit(0x85, 1); lda(r.count); jsr('setTile');
        // Native stone painting replaces both background cells. Retain an
        // overlay until the vacated portal has been painted again.
        for (const slot of [r.owner, r.destination]) {
            abs(0xAE, slot); emit(0xA9, 0xFF); sx(r.backgroundFrame);
            emit(0xA9, 1); sx(r.overlay);
        }
        emit(0xA9, 1); sta(r.command);
        label('lock');
        abs(0xAE, r.owner); emit(0xA9, 30); sx(r.cooldown);
        abs(0xAE, r.destination); sx(r.cooldown);
        label('done'); abs(0xAE, r.owner); emit(0x60);

        label('appearance'); abs(0xAE, r.owner);
        lx(r.partner); emit(0xC9, 8); branch(0xB0, 'animatedPose');
        lx(r.role); branch(0xF0, 'animatedPose');
        emit(0xA9, 6); sx(r.visual); abs(0x4C, 'probeCover');
        label('animatedPose'); lx(0x55E); sx(r.visual);
        // Last second: the entry contracts, holds, then expands. Both ends are neutral and
        // transport is disabled until the next direction becomes active.
        lx(r.clockHigh); branch(0xD0, 'probeCover');
        lx(r.clockLow); emit(0xC9, 61); branch(0xB0, 'probeCover');
        emit(0xA0, 4, 0xC9, 17); branch(0x90, 'transitionFrame');
        emit(0xC9, 45); branch(0xB0, 'transitionFrame'); emit(0xC8);
        label('transitionFrame'); emit(0x98); sx(r.visual);
        label('probeCover');
        jsr('coordinates'); emit(0xA5, 0, 0x85, 8, 0xA5, 1, 0x85, 9, 0xC9, 14);
        jumpIf(0xB0, 'done');
        // Paint legacy overlaps into the background even when occupied: the
        // exit cutscene hides sprites. Its cell writer preserves these cells.
        emit(0xA5, 0x8A, 0xC9, 14); branch(0xB0, 'checkTerrain');
        emit(0xA5, 9, 0x38, 0xE5, 0x8A, 0x18, 0x69, 1, 0xC9, 2); branch(0xB0, 'checkTerrain');
        emit(0xA5, 8, 0x38, 0xE5, 0x89, 0x18, 0x69, 1, 0xC9, 2); jumpIf(0x90, 'paintPortal');
        label('checkTerrain');
        jsr('getTile'); jumpIf(0xD0, 'covered');
        // Falling metatiles are drawn in the background even while absent
        // from map RAM; a half-step can overlap two portal rows.
        emit(0xA0, 9);
        label('coverFall'); ly(0x4C0); branch(0xF0, 'nextCoverFall'); emit(0xC9, 0xFF); branch(0xF0, 'nextCoverFall');
        ly(0x4D4); emit(0x4A, 0xC5, 8); branch(0xD0, 'nextCoverFall');
        ly(0x4DE); emit(0x4A, 0xC5, 9); jumpIf(0xF0, 'covered');
        ly(0x4DE); emit(0x29, 1); branch(0xF0, 'nextCoverFall');
        ly(0x4DE); emit(0x4A, 0x18, 0x69, 1, 0xC5, 9); jumpIf(0xF0, 'covered');
        label('nextCoverFall'); emit(0x88); branch(0x10, 'coverFall');
        label('paintPortal'); abs(0xAE, r.owner);
        // Retain the overlay until a replacement background packet is
        // queued. Busy native effects must never make an uncovered door vanish.
        emit(0x8A); abs(0xCD, r.drawCursor); jumpIf(0xD0, 'done');
        lx(r.backgroundFrame); abs(0xDD, r.visual); jumpIf(0xF0, 'advanceDraw');
        lda(r.command); emit(0xC9, 1); jumpIf(0xF0, 'done');
        emit(0xA5, 0x1E); jumpIf(0xD0, 'done');
        // Leave one tick in eight free of decorative portal packets. With
        // four pairs, lower slots must still get an empty queue to move rocks.
        emit(0xA5, 0x1B, 0x29, 7); jumpIf(0xF0, 'done');
        lx(r.visual); sx(r.backgroundFrame); emit(0xA9, 0); sx(r.overlay);
        emit(0xA5, 0x3E, 0x0A, 0x0A, 0x85, 0x0C); lx(r.group); emit(0x05, 0x0C, 0x85, 0x0C);

        // Emit one native 16-byte metatile packet, including its own 16x16
        // palette quadrant. The existing LOOP queue mirrors the whole packet.
        emit(0xA5, 8, 0x29, 15, 0x4A, 0x85, 2,
            0xA5, 9, 0x29, 0xFE, 0x0A, 0x0A, 0x05, 2, 0x85, 2,
            0xA5, 8, 0x29, 16, 0x0A, 0x0A, 0x05, 2, 0xAA, 0x86, 3,
            0xA5, 8, 0x29, 1, 0x85, 2, 0xA5, 9, 0x29, 1, 0x0A, 0x05, 2, 0x85, 5,
            0xA4, 0x0C); abs(0xB9, 'backgroundPalettes'); emit(0xA4, 5, 0xC0, 0);
        branch(0xF0, 'shiftedPalette');
        label('shiftPalette'); emit(0x0A, 0x0A, 0x88); branch(0xD0, 'shiftPalette');
        label('shiftedPalette'); emit(0x85, 0x0D, 0xA4, 5, 0xBD, 0x80, 6);
        abs(0x39, 'attributeMasks'); emit(0x05, 0x0D, 0x9D, 0x80, 6); sta(0x304);
        emit(0xA9, 6); sta(0x300); emit(0xA9, 1); sta(0x303);
        emit(0xA5, 3, 0x29, 0x3F, 0x09, 0xC0); sta(0x302);
        emit(0xA5, 8, 0x29, 16, 0x4A, 0x4A, 0x09, 0x20, 0x85, 0x0F, 0x09, 3); sta(0x301);
        emit(0xA5, 9, 0x4A, 0x4A, 0x05, 0x0F); sta(0x305); sta(0x30A);
        emit(0xA5, 8, 0x29, 15, 0x0A, 0x85, 0x0E,
            0xA5, 9, 0x29, 3, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x05, 0x0E);
        sta(0x306); emit(0x09, 32); sta(0x30B);
        emit(0xA9, 2); sta(0x307); sta(0x30C);
        abs(0xAE, r.owner); lx(r.group); emit(0x85, 0, 0x0A, 0x0A, 0x0A, 0x38, 0xE5, 0, 0x18);
        abs(0x7D, r.visual); emit(0xA8);
        ly('leftTiles'); emit(0x29, 0xFE); sta(0x308); emit(0x09, 1); sta(0x30D);
        ly('rightTiles'); emit(0x29, 0xFE); sta(0x309); emit(0x09, 1); sta(0x30E);
        emit(0xA9, 0xFF); sta(0x30F); emit(0xA9, 16, 0x85, 0x1E);
        abs(0x4C, 'advanceDraw');

        label('covered'); abs(0xAE, r.owner);
        // Reuse the numbered hollow pose while terrain or a falling tile
        // occupies this cell. appearance restores the live animation pose
        // on the next tick after it clears; the underlying clock never stops.
        emit(0xA9, 6); sx(r.visual);
        emit(0xA9, 1); sx(r.overlay); emit(0xA9, 0xFF); sx(r.backgroundFrame);
        emit(0x8A); abs(0xCD, r.drawCursor); jumpIf(0xD0, 'done');
        // A blocked/busy portal cannot permanently starve a later slot.
        label('advanceDraw'); abs(0xAE, r.owner);
        label('nextDrawSlot'); emit(0x8A, 0x38, 0xE9, 1, 0x29, 7, 0xAA);
        lx(0x4FE); emit(0xC9, 13); branch(0xD0, 'nextDrawSlot');
        emit(0x8A); sta(r.drawCursor); abs(0x4C, 'done');

        label('coordinates');
        emit(0xBD, 0x0E, 0x05, 0x25, 0x3D, 0x0A, 0x0A, 0x0A, 0x0A, 0x85, 0,
            0xBD, 0x76, 0x05, 0x4A, 0x4A, 0x4A, 0x4A, 0x05, 0, 0x85, 0,
            0xBD, 0x76, 0x05, 0x29, 15, 0x85, 1, 0x60);
        // X is scratch inside these helpers; owner is restored at return.
        label('getTile');
        emit(0xA5, 0, 0x4A, 0x85, 2, 0xA5, 1, 0x0A, 0x0A, 0x0A, 0x0A, 0x18, 0x65, 2, 0xAA,
            0xA5, 0, 0x4A, 0xBD, 0x00, 0x07); branch(0xB0, 'lowNibble');
        emit(0x4A, 0x4A, 0x4A, 0x4A);
        label('lowNibble'); emit(0x29, 15, 0x60);
        label('setTile');
        emit(0x85, 3, 0xA5, 0, 0x4A, 0x85, 2, 0xA5, 1, 0x0A, 0x0A, 0x0A, 0x0A, 0x18, 0x65, 2, 0xAA,
            0xA5, 0, 0x4A, 0xA9, 0xF0); branch(0xB0, 'mergeTile');
        emit(0x06, 3, 0x06, 3, 0x06, 3, 0x06, 3, 0xA9, 15);
        label('mergeTile'); emit(0x3D, 0x00, 0x07, 0x05, 3, 0x9D, 0x00, 0x07, 0x60);

        // Move one remaining share of the shortest distance on the 256/512
        // pixel map. Re-read the native target so walking at the exit and
        // clamped viewport edges are handled by the installed camera.
        label('panStep'); lda(r.panTicks); emit(0xC9, 1); branch(0xF0, 'panDone');
        emit(0x38, 0xA5, 0xFD); abs(0xED, r.panLow); emit(0x85, 0, 0xA5, 0x3D);
        branch(0xF0, 'narrowDelta');
        emit(0xA5, 0x9D); abs(0xED, r.panHigh); emit(0x4A); abs(0x4C, 'deltaSign');
        label('narrowDelta'); emit(0xA5, 0, 0x0A);
        label('deltaSign'); emit(0xA0, 0, 0x84, 1, 0x84, 2); branch(0x90, 'dividePan');
        emit(0xE6, 2, 0xA9, 0, 0x38, 0xE5, 0, 0x85, 0);
        branch(0x90, 'dividePan'); emit(0xE6, 1); // Magnitude 256 on a wide map.
        label('dividePan'); emit(0xA5, 0, 0x38); abs(0xED, r.panTicks);
        branch(0xB0, 'countStep'); emit(0xC6, 1); branch(0x30, 'applyStep');
        label('countStep'); emit(0x85, 0, 0xC8); abs(0x4C, 'dividePan');
        label('applyStep'); emit(0x84, 0, 0xA5, 2); branch(0xD0, 'panLeft');
        lda(r.panLow); emit(0x18, 0x65, 0, 0x85, 0xFD); lda(r.panHigh); emit(0x69, 0);
        abs(0x4C, 'panPage');
        label('panLeft'); lda(r.panLow); emit(0x38, 0xE5, 0, 0x85, 0xFD); lda(r.panHigh); emit(0xE9, 0);
        label('panPage'); emit(0x25, 0x3D, 0x85, 0x9D); sta(r.panHigh);
        emit(0xA5, 0xFD); sta(r.panLow);
        emit(0xA5, 0xFF, 0x29, 0xFE, 0x05, 0x9D, 0x85, 0xFF);
        label('panDone'); abs(0xCE, r.panTicks); emit(0x60);

        label('atSource');
        emit(0xA5, 2, 0x4A, 0x4A, 0x4A, 0x4A); abs(0xCD, r.sourceY); branch(0xD0, 'noOverlap');
        emit(0xA5, 1, 0x4A, 0xA5, 0, 0x6A, 0x4A, 0x4A, 0x4A);
        abs(0xCD, r.sourceX); branch(0xD0, 'noOverlap'); emit(0xA9, 1, 0x60);
        label('playerBlocks'); emit(0xA5, 0x7D); branch(0xD0, 'noOverlap');
        emit(0xA5, 0xC2, 0x85, 0, 0xA5, 0xC1, 0x85, 1, 0xAD, 0x1E, 0x04, 0x85, 2);
        label('overlap');
        // 16x16 body intersection against the destination, modulo map width.
        abs(0xAE, r.destination);
        emit(0x38, 0xA5, 0, 0xFD, 0x16, 0x05, 0x85, 0,
            0xA5, 1, 0xFD, 0x0E, 0x05, 0x85, 1,
            0x18, 0xA5, 0, 0x69, 15, 0x85, 0, 0xA5, 1, 0x69, 0, 0x25, 0x3D);
        branch(0xD0, 'noOverlap'); emit(0xA5, 0, 0xC9, 31); branch(0xB0, 'noOverlap');
        emit(0x38, 0xA5, 2, 0xFD, 0x33, 0x04, 0x18, 0x69, 15, 0xC9, 31); branch(0xB0, 'noOverlap');
        emit(0xA9, 1, 0x60); label('noOverlap'); emit(0xA9, 0, 0x60);

        label('attributeMasks'); emit(0xFC, 0xF3, 0xCF, 0x3F);
        const schemes = Array.from({length: 12}, (_, scene) => SpritePatterns.getPortalColorSchemes(romData, scene)).flat();
        label('backgroundPalettes');
        emit(...schemes.map(scheme => scheme.background));
        label('spritePalettes'); emit(...schemes.map(scheme => scheme.sprite));

        // Two background packets, plus native falling checks after removing
        // support and placing a stone. This executes only with bank 0 mapped.
        org(0xFC00, 0xFC48, 0x1FC10); label('paint'); emit(0x8A, 0x48);
        const coord = (x, y) => { lda(x); emit(0x85, 0); lda(y); emit(0x85, 1); };
        coord(r.sourceX, r.sourceY); jsr(0x9628);
        coord(r.sourceX, r.sourceY); jsr(0xA5E8);
        lda(r.targetX); emit(0x85, 8); lda(r.targetY); emit(0x85, 9);
        jsr(0x90F5); lda(r.count); jsr(0x9162); jsr(0x91C0); jsr(0x903D);
        coord(r.targetX, r.targetY); emit(0xE6, 1); jsr(0xA5E8); emit(0x68, 0xAA, 0x60);

        // Fixed-bank tables are readable by both the bank-1 background
        // producer and the bank-0 OAM renderer. Numbers need no extra sprites.
        org(0xFC48, 0xFC80, 0x1FC58);
        for (const [name, column] of [['leftTiles', 0], ['rightTiles', 1]]) {
            label(name);
            for (let group = 0; group < 4; group++) for (let frame = 0; frame < 7; frame++)
                emit(SpritePatterns.getPortalFrameTiles(group, frame)[column] | 1);
        }

        // Bank 7, following the bird platform worker. Skip only the exit's
        // own overlapping cells, including their attribute writes. Adjacent
        // quadrants and the native queue/fade run normally.
        org(0xF7C8, 0xF800, 0x1F7D8); label('exitCell');
        emit(0x48, 0xA5, 0x30, 0xC9, 13); branch(0xD0, 'nativeCell');
        emit(0xA0, 7); label('exitScan'); ly(0x4FE); emit(0xC9, 13); branch(0xD0, 'nextExitSlot');
        ly(0x576); emit(0x29, 15, 0xC5, 0x64); branch(0xD0, 'nextExitSlot');
        ly(0x50E); emit(0x4A); ly(0x516); emit(0x6A, 0x4A, 0x4A, 0x4A, 0xC5, 0x63);
        branch(0xF0, 'keepPortalCell');
        label('nextExitSlot'); emit(0x88); branch(0x10, 'exitScan');
        label('nativeCell'); emit(0x68); jsr(0x9162); jsr(0x91C0); abs(0x4C, 0x903D);
        label('keepPortalCell'); emit(0x68, 0x60);

        resolve();
        for (const block of parts) {
            const occupied = romData.subarray(block.file, block.file + block.limit - block.base).findIndex(byte => byte !== 0);
            if (occupied >= 0) throw new Error(`Portal transport reservation is occupied at file $${(block.file + occupied).toString(16)}`);
        }
        for (const block of parts) Asm6502.writeBytes(romData, block.file, block.bytes);
        Asm6502.writeBytes(romData, 0x3673, [0x20, 0xC8, 0xF7, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA]);
        return {start: labels.get('entry'), paint: labels.get('paint'), leftTiles: labels.get('leftTiles'),
            rightTiles: labels.get('rightTiles'), labels: Object.fromEntries(labels),
            blocks: parts.map(block => ({start: block.base, end: block.base + block.bytes.length, file: block.file}))};
    }
}
