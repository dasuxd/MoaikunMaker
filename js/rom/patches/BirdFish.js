class BirdFish {
    // Native object arrays end at $05C5. These private eight-slot arrays are
    // also cleared by the original whole-page stage reset.
    static BIRD_RAM = Object.freeze({ fright: 0x5C6, speed: 0x5CE, yHigh: 0x5D6, targetHigh: 0x5DE });

    /**
     * Enemy 12 is a harmless horizontal auxiliary. Its two scene-specific
     * 16x16 frames occupy sprite tiles $AA-$B1. Native enemy-type tables end
     * at 11, so this object bypasses their AI, collision-damage and animation
     * dispatch while retaining map probes, movement, facing and projection.
     * Rideable-platform physics live at $F5BC-$F7FF; native per-enemy Y
     * velocity/action bytes are private to this type and reset with the level.
     * Fixed bank 7 $FD00-$FDC1 is cleared former level storage. The scene CHR
     * uploader follows at $FDC2, the Tile 13 lift lives at $FE60, and pause
     * code begins at $FED9.
     */
    static addBirdFishAuxiliary(romData, passenger = {}){
        const file = RomLayout.programOffset;
        const base = 0xFD00, limit = 0xFDC2;
        if(romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved bird/fish area in bank 7 is occupied');
        const platform = BirdFish.addBirdFishPlatform(romData);
        Object.assign(passenger, platform);
        const {bytes, labels, emit, label, absolute, branch, resolve} = Asm6502.block(base, limit);

        label('dispatch');
        emit(0xC9, 0x0C); branch(0xF0, 'update');
        emit(0xC9, 0x09); branch(0xF0, 'nativeFace');
        absolute(0x4C, 0xA982);
        label('nativeFace'); absolute(0x4C, 0xA97C);

        label('update');
        // Reuse the ordinary enemy hazard checks without contact damage or
        // per-type AI: terrain, thrown stones, pushed rocks, falling objects
        // and explosions. A hit must enter death before platform init can
        // touch the RAM bytes shared with native knockback physics.
        absolute(0x20, platform.motion.hazards);
        // States 10+ use the native shared defeat table, including the
        // headbutt tumble, bottom-edge burst and respawn countdown.
        emit(0xBD, 0x06, 0x05); branch(0xD0, 'activeState');
        absolute(0x4C, platform.spawn);
        label('activeState');
        emit(0xC9, 0x0A); branch(0x90, 'patrol');
        absolute(0x4C, platform.defeat);
        label('patrol');
        // Initialize once, then keep live height and the previous world X.
        absolute(0x20, platform.init);
        absolute(0x20, platform.motion.velocity);
        emit(0xBD, 0x16, 0x05, 0x9D, 0x26, 0x05,
            0xBD, 0x33, 0x04, 0x85, 0x02,
            0xBD, 0x16, 0x05, 0x85, 0x00,
            0xBD, 0x0E, 0x05, 0x85, 0x01);
        absolute(0x20, platform.walls);
        emit(0xBD, 0x56, 0x05, 0xC9, 0x04); branch(0xF0, 'right');
        emit(0xA5, 0xAD); branch(0xF0, 'move');
        emit(0xA5, 0xAE); branch(0xD0, 'animate');
        branch(0xF0, 'reverse'); // The clear right probe left Z set.
        label('right');
        emit(0xA5, 0xAE); branch(0xF0, 'move');
        emit(0xA5, 0xAD); branch(0xD0, 'animate');
        label('reverse'); absolute(0x20, platform.reverse);
        label('move');
        // The native 8.8 X integrator wraps by the actual map width.
        absolute(0x20, 0xAFB0);

        label('animate');
        absolute(0x20, platform.update);
        emit(0xBD, 0x06, 0x05, 0xC9, 0x01); branch(0xF0, 'liveAnimation');
        absolute(0x4C, platform.project); // Top exit already cleared the metasprite.
        label('liveAnimation');
        emit(0xFE, 0x66, 0x05, 0xBD, 0x66, 0x05, 0x29, 0x07, 0x9D, 0x66, 0x05);
        branch(0xD0, 'draw');
        emit(0xBD, 0x5E, 0x05, 0x49, 0x01, 0x9D, 0x5E, 0x05);
        label('draw');
        emit(0xBD, 0x5E, 0x05, 0x18, 0x69, 0x2D, 0x9D, 0x15, 0x04);
        absolute(0x4C, platform.draw);

        // Add simple metasprites $2D-$2E without consuming existing entries.
        // Optional type 15 uses $4D-$4F and the final 17 bytes of this block.
        // Each frame is two adjacent 8x16 hardware sprites; the native OAM
        // builder still handles horizontal flipping, clipping and palettes.
        label('render');
        if (Penguin.ENABLED) {
            emit(0xA0, 0, 0xC9, Penguin.META); branch(0x90, 'birdRender');
            emit(0xC9, Penguin.META + 3); branch(0xB0, 'nativeRender');
            // CMP left carry clear; subtract META-1 to obtain frame 0..2.
            emit(0xE9, Penguin.META - 1, 0x0A, 0x0A, 0x69, Penguin.TILE);
            absolute(0x4C, 'columns'); // Y=0: share the player's palette, like birds.
        }
        label('birdRender');
        emit(0xC9, 0x2D); branch(0x90, 'nativeRender');
        emit(0xC9, 0x2F); branch(0xB0, 'nativeRender');
        // CMP #$2F left carry clear. SBC #$2C supplies frames 0/1; both
        // shifts and additions below stay below $100 and leave carry clear.
        emit(0xE9, 0x2C, 0x0A, 0x0A, 0x69, 0xAA);
        label('columns'); emit(0x85, 0x10, 0x69, 0x02, 0x85, 0x11);
        if (Penguin.ENABLED) emit(0x84, 0x12, 0x84, 0x13);
        else emit(0xA9, 0x00, 0x85, 0x12, 0x85, 0x13); // Player sprite palette.
        absolute(0x4C, 0x8951);
        label('nativeRender');
        emit(0x0A); branch(0xB0, 'largeRender');
        absolute(0x4C, 0x8935);
        label('largeRender'); absolute(0x4C, 0x8991);

        resolve();
        Asm6502.writeBytes(romData, file(base), bytes);
        Asm6502.writeBytes(romData, file(0xA978), [0x4C, base & 0xFF, base >> 8, 0xEA]);
        const render = labels.get('render');
        Asm6502.writeBytes(romData, file(0x8932), [0x4C, render & 0xFF, render >> 8]);
        BirdFish.addBirdFishLift(romData, platform.motion);
        return render;
    }

    /** Tile 13 scatters live birds/fish upward instead of stunning them. */
    static addBirdFishLift(romData, motion = BirdFish.addBirdFishMotion(romData)){
        // Scene graphics end before $FE60; Terrain's optional Tile 9 break
        // helper starts at $FEB8, followed by pause at $FED9. Cleared on export.
        const base = 0xFE60, limit = 0xFEB8;
        const file = RomLayout.programOffset;
        if(romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved bird/fish lift area in bank 7 is occupied');
        const {bytes, labels, emit, label, absolute, branch, resolve} = Asm6502.block(base, limit);

        // $B374 runs once per actual Tile 13 impact. Before $B388 it has
        // already skipped empty slots and native collision-immune enemies.
        emit(0xBD, 0xFE, 0x04, 0xC9, 0x0C); branch(0xF0, 'bird');
        emit(0xBD, 0x06, 0x05); absolute(0x4C, 0xB38B); // Original instruction/continuation.
        label('bird');
        emit(0xBD, 0x06, 0x05, 0xC9, 0x01); branch(0xD0, 'next');
        // Preserve the caller's scratch coordinates while computing both
        // the new height and shortest horizontal distance on a looping map.
        emit(0xA5, 0x00, 0x48, 0xA5, 0x01, 0x48);
        // A signed target can reach -8. The actual top-edge renderer exit
        // starts the ordinary respawn delay rather than wrapping to the bottom.
        absolute(0x20, motion.liftTarget);
        emit(0x38, 0xBD, 0x16, 0x05, 0xE5, 0xC2, 0x85, 0x00,
            0xBD, 0x0E, 0x05, 0xE5, 0xC1, 0x25, 0x3D, 0x85, 0x01);
        absolute(0x20, motion.startFright);
        emit(0xA5, 0x3D);
        branch(0xD0, 'wide');
        // Narrow maps use the low byte's sign; equal X and half a loop
        // have no unique away direction, so retain the current facing.
        emit(0xA5, 0x00, 0x0A); branch(0xF0, 'restore');
        branch(0xB0, 'left'); branch(0x90, 'right');
        label('wide');
        emit(0xA5, 0x00); branch(0xF0, 'restore');
        emit(0xA5, 0x01); branch(0xD0, 'left');
        label('right'); emit(0xA9, 0x04); branch(0xD0, 'facing');
        label('left'); emit(0xA9, 0x03);
        label('facing'); emit(0x9D, 0x56, 0x05);
        label('restore'); emit(0x68, 0x85, 0x01, 0x68, 0x85, 0x00);
        label('next'); absolute(0x4C, 0xB3B6);

        resolve();
        Asm6502.writeBytes(romData, file(base), bytes);
        Asm6502.writeBytes(romData, file(0xB388), [0x4C, base & 255, base >> 8]);
        return base;
    }

    /** Signed top-edge motion and distance-dependent fright during ascent. */
    static addBirdFishMotion(romData){
        // The ending fonts live in bank 1; its fixed-bank text/code ends at
        // $F940. Keep this worker below the sprite portal preview at $FB00.
        // $FAE0-$FAFF is reserved for Terrain's optional solid-crush lookup.
        const base = 0xF940, limit = 0xFAE0;
        const file = RomLayout.programOffset;
        if(romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved bird/fish motion area in bank 7 is occupied');
        const { fright, speed, yHigh, targetHigh } = BirdFish.BIRD_RAM;
        const {bytes, labels, emit, label, absolute, branch, resolve} = Asm6502.block(base, limit);
        const slot = (opcode, address) => emit(opcode, address & 255, address >> 8);

        label('reset'); emit(0xA9, 0x00);
        for(const address of [fright, speed, yHigh, targetHigh]) slot(0x9D, address);
        emit(0x60);

        // All four original hazard routines interpret Y as unsigned. Skip
        // them above the map rather than sampling the bottom row's RAM.
        label('hazards'); slot(0xBD, yHigh); branch(0x30, 'hazardsDone');
        for(const entry of [0xB0D6, 0xB25D, 0xB20C, 0xB19B]) absolute(0x20, entry);
        label('hazardsDone'); emit(0x60);

        label('liftTarget');
        slot(0xBD, targetHigh); branch(0xD0, 'exitTarget');
        emit(0x18, 0xBD, 0x46, 0x05, 0x7D, 0x6E, 0x05, 0x38, 0xE9, 0x10);
        branch(0xB0, 'positiveTarget'); emit(0xC9, 0xF8); branch(0xB0, 'negativeTarget');
        label('exitTarget'); emit(0xA9, 0xF8);
        label('negativeTarget'); emit(0x9D, 0x46, 0x05, 0xA9, 0xFF); slot(0x9D, targetHigh);
        emit(0xA9, 0x00); absolute(0x4C, 'clearStep');
        label('positiveTarget'); emit(0x9D, 0x46, 0x05, 0xA9, 0x00); slot(0x9D, targetHigh);
        label('clearStep'); emit(0x9D, 0x6E, 0x05, 0x9D, 0x7E, 0x05, 0x60);

        // $00:$01 is the wrapped bird-minus-player X calculated at impact.
        // Convert it to an absolute shortest distance without changing it;
        // the caller still needs those bytes to choose the escape direction.
        label('startFright');
        emit(0xA5, 0x3D); branch(0xF0, 'narrowDistance');
        emit(0xA5, 0x01); branch(0xF0, 'positiveDistance');
        emit(0xA5, 0x00); branch(0xF0, 'farDistance'); branch(0xD0, 'negativeDistance');
        label('narrowDistance'); emit(0xA5, 0x00); branch(0x10, 'positiveDistance');
        label('negativeDistance'); emit(0xA5, 0x00, 0x49, 0xFF, 0x18, 0x69, 0x01);
        absolute(0x4C, 'distance');
        label('positiveDistance'); emit(0xA5, 0x00);
        label('distance'); emit(0x4A, 0x4A, 0x4A, 0x4A, 0x4A, 0xC9, 0x03);
        branch(0x90, 'distanceTier');
        label('farDistance'); emit(0xA9, 0x03);
        label('distanceTier'); emit(0x49, 0x03); slot(0x9D, speed);
        emit(0xA9, 0x01); slot(0x9D, fright); emit(0x60);

        // Only cancel the temporary horizontal boost. Keep the height goal
        // and signed coordinates so a blocked ascent can resume normally.
        label('finishFright'); slot(0xBD, fright); branch(0xF0, 'frightDone');
        emit(0xA9, 0x00); slot(0x9D, fright); slot(0x9D, speed);
        absolute(0x4C, 'velocity');
        label('frightDone'); emit(0x60);

        // Four exact 8.8 speeds: 0.5, 1, 1.5, 2 pixels per active update.
        // Acceleration only belongs to the upward leg, including when a
        // landing changes its destination before the next patrol update.
        label('velocity'); slot(0xBD, fright); branch(0xF0, 'normalSpeed');
        absolute(0x20, 'compareHeight'); branch(0xB0, 'normalSpeed');
        slot(0xBD, speed); absolute(0x4C, 'speedMagnitude');
        label('normalSpeed'); emit(0xA9, 0x00); slot(0x9D, fright); slot(0x9D, speed);
        label('speedMagnitude'); emit(0x18, 0x69, 0x01, 0x4A, 0x9D, 0x2E, 0x05,
            0xA9, 0x00, 0x6A, 0x9D, 0x36, 0x05,
            0xBD, 0x56, 0x05, 0xC9, 0x04); branch(0xB0, 'velocityDone');
        emit(0x38, 0xA9, 0x00, 0xFD, 0x36, 0x05, 0x9D, 0x36, 0x05,
            0xA9, 0x00, 0xFD, 0x2E, 0x05, 0x9D, 0x2E, 0x05);
        label('velocityDone'); emit(0x60);

        label('compareHeight'); slot(0xBD, targetHigh); slot(0xDD, yHigh);
        branch(0xF0, 'compareLow');
        slot(0xBD, targetHigh); emit(0x49, 0xFF, 0xC9, 0x80, 0x60);
        label('compareLow');
        emit(0x18, 0xBD, 0x46, 0x05, 0x7D, 0x6E, 0x05, 0xDD, 0x33, 0x04, 0x60);

        label('rise');
        slot(0xBD, yHigh); branch(0x30, 'riderCeiling');
        emit(0xBD, 0x33, 0x04, 0xC9, 0x09); branch(0x90, 'riderCeiling');
        emit(0x38, 0xE9, 0x09); absolute(0x20, 'bodyProbe'); branch(0xD0, 'stopFright');
        label('riderCeiling');
        emit(0xBD, 0x3E, 0x05); branch(0xF0, 'riseFree');
        absolute(0x20, 0x9BD5); branch(0xB0, 'stopFright');
        label('riseFree'); emit(0xBD, 0x33, 0x04); branch(0xD0, 'decrementY');
        slot(0xDE, yHigh);
        label('decrementY'); emit(0xDE, 0x33, 0x04);
        // Native 8x16 OAM uses Y-1: at anchor zero its Y=$FF is completely
        // hidden, so remove it now rather than leave an invisible platform.
        emit(0xBD, 0x33, 0x04); branch(0xF0, 'departed');
        slot(0xBD, yHigh); branch(0x10, 'riseDone');
        emit(0xBD, 0x33, 0x04, 0xC9, 0xF9); branch(0xB0, 'riseDone');
        // Keep the type/birthplace, clear support, and enter the existing
        // 200-tick respawn countdown. Also accept older negative-Y saves.
        label('departed');
        absolute(0x20, 'reset');
        emit(0xA9, 0x00, 0x9D, 0x3E, 0x05, 0x9D, 0x6E, 0x05,
            0xA9, 0x80, 0x9D, 0x4E, 0x05, 0x98, 0x48);
        absolute(0x20, 0xAC22); emit(0x68, 0xA8, 0x60);
        label('riseDone'); absolute(0x20, 'compareHeight'); branch(0xF0, 'stopFright'); emit(0x60);
        label('stopFright'); absolute(0x4C, 'finishFright');

        // The body may straddle two rows. Above row zero, never include
        // row 15 samples caused by the original unsigned tile sampler.
        label('walls'); slot(0xBD, yHigh); branch(0x30, 'noWalls');
        absolute(0x20, 0x9330);
        emit(0xA5, 0x02, 0xC9, 0x08); branch(0xB0, 'wallRows');
        emit(0xA9, 0x00, 0x85, 0xAF, 0x85, 0xB0);
        label('wallRows'); emit(0xA5, 0x02, 0x29, 0x0F, 0xC9, 0x08); branch(0xF0, 'wallsDone');
        emit(0xA5, 0xAD, 0x05, 0xAF, 0x05, 0xB1, 0x85, 0xAD,
            0xA5, 0xAE, 0x05, 0xB0, 0x05, 0xB2, 0x85, 0xAE);
        label('wallsDone'); emit(0x60);
        label('noWalls'); emit(0xA9, 0x00, 0x85, 0xAD, 0x85, 0xAE, 0x60);

        label('bodyProbe');
        emit(0x85, 0x02, 0x98, 0x48,
            0xBD, 0x16, 0x05, 0x85, 0x00, 0xBD, 0x0E, 0x05, 0x85, 0x01,
            0x20, 0x30, 0x93, 0x68, 0xA8, 0xA5, 0xAC, 0x05, 0xAD, 0x05, 0xAE, 0x60);

        resolve();
        Asm6502.writeBytes(romData, file(base), bytes);
        return Object.fromEntries(['reset', 'hazards', 'liftTarget', 'startFright', 'finishFright', 'velocity',
            'compareHeight', 'rise', 'walls', 'bodyProbe'].map(name => [name, labels.get(name)]));
    }

    /** One-way birds/fish: two distinct landings commit one 16px step. */
    static addBirdFishPlatform(romData){
        const base = 0xF5BC, limit = 0xF7C8;
        const file = RomLayout.programOffset;
        if(romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved bird/fish platform area in bank 7 is occupied');
        const motion = BirdFish.addBirdFishMotion(romData);
        const {bytes, labels, emit, label, absolute, branch, resolve} = Asm6502.block(base, limit);
        // $053E rider latch; $0546 committed Y; $056E temporary 8px step;
        // $057E recovery timer; $0526 previous X for horizontal carrying.
        label('init');
        emit(0xBD, 0x06, 0x05); branch(0xD0, 'initialized');
        emit(0xBD, 0x76, 0x05, 0x0A, 0x0A, 0x0A, 0x0A, 0x09, 0x08,
            0x9D, 0x33, 0x04, 0x9D, 0x46, 0x05);
        absolute(0x20, 0xAAF4); // Native frame, animation, action and flag reset; A=0.
        emit(0x9D, 0x3E, 0x05);
        absolute(0x20, motion.reset);
        emit(0xFE, 0x06, 0x05); // State 0 becomes live state 1 only on spawn.
        label('initialized');
        emit(0xA9, 0x00, 0x9D, 0x4E, 0x05, 0x9D, 0x6F, 0x04);
        emit(0x60);

        label('detach'); emit(0xA9, 0x00, 0x9D, 0x3E, 0x05);
        absolute(0x4C, 'vertical');
        label('update');
        emit(0xA5, 0x56, 0xC9, 0x03); branch(0xD0, 'detach');
        emit(0xA5, 0xC0, 0xC9, 0x03); branch(0xB0, 'detach');
        emit(0xA5, 0xC7); branch(0x30, 'detach');
        absolute(0x20, 'overlap'); branch(0x90, 'detach');
        emit(0xBD, 0x3E, 0x05); branch(0xF0, 'landing');
        // A rider stays latched until an actual jump or a walk off the edge.
        emit(0xA5, 0xC0, 0xC9, 0x01); branch(0xF0, 'vertical');
        label('landing');
        emit(0xA5, 0xC0, 0xC9, 0x02); branch(0xD0, 'detach');
        // Descending feet must cross the top this frame, not the sides/bottom.
        emit(0x18, 0xAD, 0x1E, 0x04, 0x69, 0x10, 0x85, 0x02,
            0xA5, 0x7D, 0x69, 0x00);
        absolute(0xDD, BirdFish.BIRD_RAM.yHigh); branch(0xD0, 'detach');
        emit(0xA5, 0x02, 0x38, 0xFD, 0x33, 0x04); branch(0x90, 'detach');
        emit(0x85, 0x00, 0xA5, 0xC7, 0x18, 0x69, 0x01, 0xC5, 0x00);
        branch(0x90, 'detach');
        emit(0xA9, 0x01, 0x9D, 0x3E, 0x05, 0x85, 0xC0,
            0xA9, 0x00, 0x85, 0xC4, 0x85, 0xC7, 0x85, 0xC8,
            0x85, 0xDA, 0x85, 0x5B);
        // One landing temporarily lowers the bird half a tile; a second
        // landing before recovery commits the next complete tile instead.
        emit(0xBD, 0x46, 0x05, 0xC9, 0xD9); branch(0xB0, 'vertical');
        emit(0xBD, 0x6E, 0x05); branch(0xD0, 'commit');
        emit(0xA9, 0x08, 0x9D, 0x6E, 0x05,
            0xA9, 0x5A, 0x9D, 0x7E, 0x05);
        absolute(0x4C, 'vertical');
        // A floor cancels the unfinished drop at the actual supported height.
        // Never bank blocked landings for a later fall after leaving a ledge.
        label('blockedDescent');
        emit(0xBD, 0x33, 0x04, 0x9D, 0x46, 0x05);
        absolute(0x4C, 'clearDrop');
        label('commit');
        // Bottom row 13 is Y=$D8. Its half-step $E0 leaves the rider at
        // $D0, safely above native death Y=$D5; a full step $E8 would not.
        emit(0xBD, 0x46, 0x05, 0xC9, 0xD8); branch(0xB0, 'vertical');
        emit(0x69, 0x10, 0x9D, 0x46, 0x05); // CMP left carry clear.
        label('clearDrop');
        emit(0xA9, 0x00, 0x9D, 0x6E, 0x05, 0x9D, 0x7E, 0x05);
        label('vertical');
        // Ease one pixel/frame, counting the recovery delay only once the
        // lower half-step is reached so short and full jumps can both commit.
        absolute(0x20, motion.compareHeight);
        branch(0xF0, 'atTarget'); branch(0x90, 'rise');
        absolute(0x20, motion.finishFright); // A stomp can replace the rising goal with a drop.
        // Sample the leading body edge, including either horizontal tile.
        // This private probe remains valid between native 16px grid rows.
        emit(0xBD, 0x33, 0x04, 0x18, 0x69, 0x08);
        absolute(0x20, motion.bodyProbe); branch(0xD0, 'blockedDescent');
        // A floor takes over support when the carrier sinks below it.
        emit(0xBD, 0x3E, 0x05); branch(0xF0, 'sink');
        absolute(0x20, 0x9BE3); branch(0x90, 'sink');
        emit(0xA9, 0x00, 0x9D, 0x3E, 0x05);
        label('sink');
        emit(0xFE, 0x33, 0x04); absolute(0x4C, 'carry');
        label('rise');
        absolute(0x20, motion.rise);
        emit(0xBD, 0x06, 0x05, 0xC9, 0x01); branch(0xF0, 'carry'); emit(0x60);
        label('atTarget');
        absolute(0x20, motion.finishFright);
        emit(0xBD, 0x7E, 0x05); branch(0xF0, 'carry');
        emit(0xDE, 0x7E, 0x05); branch(0xD0, 'carry');
        emit(0xA9, 0x00, 0x9D, 0x6E, 0x05);
        label('carry');
        emit(0xBD, 0x3E, 0x05); branch(0xD0, 'carryRider'); emit(0x60);
        label('carryRider');
        emit(0x38, 0xBD, 0x33, 0x04, 0xE9, 0x10, 0x8D, 0x1E, 0x04);
        absolute(0xBD, BirdFish.BIRD_RAM.yHigh);
        emit(0xE9, 0x00, 0x85, 0x7D,
            0xA9, 0x00, 0x85, 0xC4, 0x85, 0xC7, 0x85, 0xC8,
            0x38, 0xBD, 0x16, 0x05, 0xFD, 0x26, 0x05);
        branch(0xF0, 'return');
        absolute(0x20, 'shiftPlayerX');
        // Native body probes prevent a moving platform from carrying a
        // standing player through walls. Roll back only the carried pixel.
        // The movement delta, rather than an unsigned comparison, handles seams.
        emit(0xBD, 0x16, 0x05, 0x38, 0xFD, 0x26, 0x05); branch(0x30, 'probeLeft');
        absolute(0x20, 0x9BBD); absolute(0x4C, 'probeResult');
        label('probeLeft'); absolute(0x20, 0x9BB9);
        label('probeResult'); branch(0x90, 'return');
        emit(0x38, 0xBD, 0x26, 0x05, 0xFD, 0x16, 0x05);
        absolute(0x20, 'shiftPlayerX');
        // Native player projection ran before this carrier moved. Refresh its
        // screen X from the final carried (or wall-rolled-back) position so
        // player and bird OAM use the same frame. Do not call $943C again:
        // that entry would also decrement the player's blink timer twice.
        label('return');
        emit(0x38, 0xA5, 0xC2, 0xE5, 0xFD, 0x8D, 0x3C, 0x04, 0x60);

        // Shared signed carry/rollback addition keeps both map seams exact.
        // ASL captures the delta sign; the high byte is 0 or $FF on the stack
        // while the low-byte addition supplies its own carry.
        label('shiftPlayerX');
        emit(0x85, 0x00, 0x0A, 0xA9, 0x00, 0xE9, 0x00, 0x49, 0xFF, 0x48,
            0x18, 0xA5, 0xC2, 0x65, 0x00, 0x85, 0xC2, 0x68,
            0x65, 0xC1, 0x25, 0x3D, 0x85, 0xC1, 0x60);

        // Match world X modulo the actual map width, including either seam.
        label('overlap');
        emit(0x38, 0xA5, 0xC2, 0xFD, 0x16, 0x05, 0x85, 0x00,
            0xA5, 0xC1, 0xFD, 0x0E, 0x05, 0x85, 0x01,
            0x18, 0xA5, 0x00, 0x69, 0x0D, 0x85, 0x00,
            0xA5, 0x01, 0x69, 0x00, 0x25, 0x3D);
        branch(0xD0, 'miss');
        emit(0xA5, 0x00, 0xC9, 0x1B); branch(0xB0, 'miss');
        emit(0x38); label('supportDone'); emit(0x60); label('miss'); emit(0x18, 0x60);

        // Native ground handling still owns jumping and walking. Supply its
        // support probe while aboard, preserving X for the original caller.
        label('support'); absolute(0x20, 'findRider');
        branch(0xB0, 'supportDone'); absolute(0x4C, 0x9BE3);
        label('findRider'); emit(0x8A, 0x48, 0xA2, 0x07);
        label('supportLoop');
        emit(0xBD, 0xFE, 0x04, 0xC9, 0x0C);
        if (Penguin.ENABLED) { branch(0xF0, 'supportType'); emit(0xC9, 15); }
        branch(0xD0, 'nextSupport'); label('supportType');
        // Native tumble physics reuse the rider byte as signed Y velocity.
        // Only a live, standing carrier can supply platform support.
        emit(0xBD, 0x06, 0x05, 0xC9, 0x01); branch(0xD0, 'nextSupport');
        emit(0xBD, 0x3E, 0x05); branch(0xF0, 'nextSupport');
        absolute(0x20, 'overlap'); branch(0xB0, 'supported');
        label('nextSupport'); emit(0xCA); branch(0x10, 'supportLoop');
        // A match leaves X=0..7; an exhausted search leaves X=$FF.
        label('supported'); emit(0xE8, 0xE0, 0x01, 0x68, 0xAA, 0x60);

        // Riders never choose horizontal direction: patrol reverses normally.
        label('reverse');
        absolute(0x20, 0xB013);
        absolute(0x20, 0xAFEF); // Velocity was prepared before wall probes; reverse it this frame too.
        emit(0x18, 0x60);

        // $A9CF maps states 10+ to type-independent routines. Preserve the
        // native knockback velocities, current bird/fish frame and tumble
        // flips; $AF68 would erase those flips and $AE6A needs a type table.
        label('defeat'); absolute(0x20, 0xA9CF); absolute(0x4C, 'project');

        // State 0 uses the ordinary 90-frame smoke clock and its shared
        // frames. Avoid native type-indexed completion/animation tables,
        // which end at type 11. Spawn and respawn follow the same path.
        label('spawn'); absolute(0x20, motion.reset); absolute(0x20, 0xAE9C);
        emit(0xBD, 0x66, 0x05, 0x1D, 0x5E, 0x05); branch(0xF0, 'spawned');
        emit(0xA9, 0x80, 0x9D, 0x4E, 0x05,
            0xBC, 0x5E, 0x05, 0xB9, 0x30, 0xB5, 0x9D, 0x15, 0x04);
        absolute(0x4C, 'draw');
        label('spawned'); absolute(0x20, 'init');
        emit(0xA9, 0x2D, 0x9D, 0x15, 0x04);
        // Smoke clears death tumble flips and uses native horizontal facing.
        // Defeat skips this live-facing entry so its tumble stays visible.
        label('draw'); absolute(0x20, 0xAF68);
        label('project');
        absolute(0x20, 0xAE54); absolute(0x4C, 0xA9B3);

        resolve();
        Asm6502.writeBytes(romData, file(base), bytes);
        const support = labels.get('support');
        Asm6502.writeBytes(romData, file(0x9584), [0x20, support & 255, support >> 8]);
        // Keep all controls native; Up/Down no longer command bird movement.
        Asm6502.writeBytes(romData, file(0x8B57), [0x20, 0x1A, 0x94]);
        return {init: labels.get('init'), update: labels.get('update'), walls: motion.walls, motion,
            reverse: labels.get('reverse'), defeat: labels.get('defeat'),
            spawn: labels.get('spawn'), draw: labels.get('draw'), project: labels.get('project'),
            findRider: labels.get('findRider'), overlap: labels.get('overlap'),
            carry: labels.get('carry'), playerControl: 0x941A};
    }
}
