class ViewModes {
    /**
     * Pause controls select fixed/bounded or centered looping views.
     * $2A holds the runtime choice and transition flag, independent of the
     * native title/password selection in $21. Helpers live in fixed bank 7,
     * CPU $F100-$F40F, cleared after level storage is relocated to bank 4.
     * The original password code, title strings and ending remain intact.
     */
    static addViewModes(romData){
        const fixedShift = 0x18000;
        const fileAddress = (cpu) => cpu - 0x8000 + 0x10 +
            (cpu >= 0xC000 ? fixedShift : 0);
        const patch = (cpu, bytes) =>
            Asm6502.writeBytes(romData, fileAddress(cpu), bytes);
        // getROMData() clears relocated native level storage before any code
        // insertion. Fail visibly if a future patch starts using our reservation.
        if(romData.subarray(fileAddress(0xF100),fileAddress(0xF410)).some(byte => byte !== 0))
            throw new Error('Reserved view-patch area in bank 7 is occupied');

        // Resolve local 6502 labels and enforce each reserved block boundary.
        const {labels, blocks, section, emit, label, absolute, branch, resolve} = Asm6502.program();
        let block;
        const org = (base, limit) => {
            if (base < 0xF100 || limit > 0xF410 || limit <= base || (block && base < block.limit))
                throw new Error('View-patch blocks overlap or exceed their reservation');
            block = section(base, limit);
        };

        // Fixed bank 7: relocated level storage, cleared by getROMData().
        // $2A: bit 0 = loop, bit 6 = paused return, bit 7 = transition.
        // Native gameplay has no direct reference to this byte. Title entry
        // initializes it; death/next-stage camera resets preserve the choice.
        org(0xF100, 0xF2B0);
        label('camera');
        emit(0xA5, 0x56, 0xC9, 0x03); // LDA stageState; CMP #live
        branch(0xF0, 'liveCamera');
        absolute(0x4C, 'reset');
        label('liveCamera');
        emit(0xA5, 0x1F);             // Attract demos do not read player input.
        branch(0xD0, 'normalCamera');
        label('selectCamera');
        emit(0xA5, 0x2A, 0x29, 0x01);
        branch(0xD0, 'loopCamera');
        label('normalCamera');
        emit(0xA9, 0x00, 0x85, 0x00, 0x85, 0x01, 0xA5, 0x3D);
        branch(0xF0, 'targetReady');
        // Native wide camera: clamp playerX - 128 to 0..255.
        emit(0xA5, 0xC1);
        branch(0xD0, 'normalRightPage');
        emit(0xA5, 0xC2, 0xC9, 0x80);
        branch(0x90, 'targetReady');
        emit(0xE9, 0x80, 0x85, 0x00);
        absolute(0x4C, 'targetReady');
        label('normalRightPage');
        emit(0xA5, 0xC2, 0xC9, 0x7F);
        branch(0xB0, 'normalRightEdge');
        emit(0x38, 0xE9, 0x80, 0x85, 0x00);
        absolute(0x4C, 'targetReady');
        label('normalRightEdge');
        emit(0xA9, 0xFF, 0x85, 0x00);
        absolute(0x4C, 'targetReady');
        label('loopCamera');
        emit(0x38, 0xA5, 0xC2, 0xE9, 0x80, 0x85, 0x00,
             0xA5, 0xC1, 0xE9, 0x00, 0x25, 0x3D, 0x85, 0x01);
        label('targetReady');
        emit(0xA5, 0x2A);
        branch(0x10, 'assignTarget');
        // Shortest signed displacement on the 256/512-pixel ring.
        emit(0x38, 0xA5, 0x00, 0xE5, 0xFD, 0x85, 0x02,
             0xA5, 0x01, 0xE5, 0x9D, 0x25, 0x3D, 0x85, 0x03,
             0xA5, 0x3D);
        branch(0xD0, 'wideDirection');
        emit(0xA5, 0x02);
        branch(0x30, 'moveLeft');
        absolute(0x4C, 'moveRight');
        label('wideDirection');
        emit(0xA5, 0x03);
        branch(0xD0, 'moveLeft');
        label('moveRight');
        emit(0xA5, 0x02, 0xC9, 0x05);
        branch(0x90, 'assignTarget');
        emit(0x18, 0xA5, 0xFD, 0x69, 0x04, 0x85, 0xFD,
             0xA5, 0x9D, 0x69, 0x00, 0x25, 0x3D, 0x85, 0x9D);
        absolute(0x4C, 'page');
        label('moveLeft');
        emit(0xA5, 0x02, 0xC9, 0xFC);
        branch(0xB0, 'assignTarget');
        emit(0x38, 0xA5, 0xFD, 0xE9, 0x04, 0x85, 0xFD,
             0xA5, 0x9D, 0xE9, 0x00, 0x25, 0x3D, 0x85, 0x9D);
        absolute(0x4C, 'page');
        label('assignTarget');
        emit(0xA5, 0x00, 0x85, 0xFD, 0xA5, 0x01, 0x85, 0x9D,
             0xA5, 0x2A, 0x29, 0x41, 0x85, 0x2A);
        absolute(0x4C, 'page');
        label('reset');
        emit(0xA9, 0x00, 0x85, 0xFD, 0x85, 0x9D);
        label('page');
        emit(0xA5, 0xFF, 0x29, 0xFE, 0x05, 0x9D, 0x85, 0xFF, 0x60);

        label('pause');
        emit(0x4C, 0xCB, 0xB3); // Unified pause controller, installed below.

        // Attribute initialization bypasses map lookup: normalize the byte
        // column before indexing $0700 so the repeated page has matching
        // foreground palettes too. This applies to both single-screen views.
        label('attributeIndex');
        emit(0x65, 0x00, 0x48, 0xA5, 0x3D);
        branch(0xD0, 'wideAttribute');
        emit(0x68, 0x29, 0xF7, 0xAA, 0x60);
        label('wideAttribute');
        emit(0x68, 0xAA, 0x60);

        // Keep the two attribute-cache halves coherent after each mutation,
        // including multiple changes within the same frame. Preserve A/X/Y
        // and flags because $BBA5 and $903D have different callers.
        label('attributeStore');
        emit(0x99, 0x80, 0x06, 0x08, 0x48, 0xA5, 0x3D);
        branch(0xD0, 'attributeDone');
        emit(0x8A, 0x48, 0xBA); // Save X, then use X=SP for stack lookup.
        // Recover the original attribute value without allocating scratch RAM.
        emit(0x98, 0x49, 0x40, 0xA8, 0xBD, 0x02, 0x01,
             0x99, 0x80, 0x06, 0x98, 0x49, 0x40, 0xA8, 0x68, 0xAA);
        label('attributeDone');
        emit(0x68, 0x28, 0x60);

        label('titleReset');
        // Start new games with centered looping follow enabled.
        emit(0xA9, 0x01, 0x85, 0x2A, 0x20, 0x60, 0xFF, 0x4C, 0x2E, 0xDA);

        label('stageReset');
        // Stage text/loading must keep page 0; the first live frame then
        // approaches the selected view instead of assigning it immediately.
        emit(0x20, 0x60, 0xFF, 0xA5, 0x2A, 0x09, 0x80, 0x85, 0x2A, 0x60);

        // Prepare the opposite page AFTER the current frame's producers,
        // outside the next NMI's VRAM-transfer window. The original PPU
        // interpreter then consumes both pages without validation/replay work.
        label('queueScan');
        emit(0xC4, 0x01);
        branch(0xF0, 'queueDone');
        emit(0x98, 0x85, 0x03, 0xB9, 0x00, 0x03, 0xC9, 0x09);
        branch(0xB0, 'queueSkipReset'); // 9 is the last defined command code.
        emit(0xC9, 0x03);
        branch(0xF0, 'queueSkipFill');
        emit(0xC9, 0x06);
        branch(0x90, 'queueDone');
        absolute(0x20, 'queueNametableCommand');
        branch(0xB0, 'queueSkipCommand');
        // Y is the terminator index. Reserve the complete copied command AND
        // its final zero before writing anything; $03E0 begins palette RAM.
        emit(0x98, 0x38, 0xE5, 0x03, 0x85, 0x02,
             0x8A, 0x38, 0x65, 0x02);
        branch(0xB0, 'queueSkipCommand');
        emit(0xC9, 0xE0);
        branch(0xB0, 'queueSkipCommand');
        emit(0xA4, 0x03, 0xC8, 0xA9, 0x06, 0x9D, 0x00, 0x03, 0xE8);
        absolute(0x4C, 'queueMirrorAddress');
        label('queueSkipReset');
        emit(0xC8);
        absolute(0x4C, 'queueScan');
        label('queueSkipFill');
        emit(0x98, 0x69, 0x04, 0xA8); // Matching CMP #3 left carry set.
        absolute(0x4C, 'queueScan');
        label('queueDone');
        absolute(0x4C, 'queueCommit');
        label('queueSkipCommand');
        emit(0xC8);
        absolute(0x4C, 'queueScan');

        // Enemies run AFTER rescues. Reserve an imminent 34-byte fire packet
        // before admitting rescue animation. Falling objects use their own
        // quota and run first; a busy falling frame defers fire instead.
        // Predict the native B9C7/B9EA tick without advancing fire state or
        // collision length. Phase 15 hands off to a face whose timer is reset,
        // so even a later slot cannot draw again during that handoff frame.
        label('reserveFireQueue');
        emit(0x8A, 0x48, 0xA2, 0x07); // Save X; inspect all eight enemy slots.
        label('checkFireSlot');
        emit(0xBD, 0xFE, 0x04, 0xC9, 0x09);
        branch(0xD0, 'nextFireSlot');
        emit(0xBD, 0x06, 0x05);
        branch(0xF0, 'nextFireSlot');
        emit(0xBD, 0x7E, 0x05, 0xC9, 0x0F);
        branch(0xB0, 'nextFireSlot');
        emit(0xBD, 0x66, 0x05, 0x18, 0x69, 0x01, 0xC9, 0x03);
        branch(0x90, 'nextFireSlot');
        emit(0x68, 0xAA, 0xA5, 0x1E, 0x38, 0x60); // Defer, preserve A/X/Y.
        label('nextFireSlot');
        emit(0xCA);
        branch(0x10, 'checkFireSlot');
        emit(0x68, 0xAA, 0xA5, 0x1E, 0xC9, 0x10, 0x60);

        // Scene-8 decorations run after enemies. Keep their staggered timers
        // together by postponing the whole decoration tick on busy narrow
        // frames; a rock push plus fire otherwise leaves no room for a flag.
        label('sceneAnimationQueue');
        emit(0xA5, 0x3D);
        branch(0xD0, 'drawSceneAnimations');
        emit(0xA5, 0x1E, 0xC9, 0x20);
        branch(0xB0, 'sceneAnimationDone');
        label('drawSceneAnimations');
        emit(0x4C, 0xD9, 0xD8);
        label('sceneAnimationDone');
        emit(0x60);

        // Freeze only a fire tick that would draw into a busy queue. The
        // native off-tick path still checks damage against the unchanged,
        // visible flame length. Idle ticks and phase-15 handoff run normally.
        label('fireTickQueue');
        emit(0xBD, 0x06, 0x05);
        branch(0xF0, 'nativeFireTick');
        emit(0xBD, 0x7E, 0x05, 0xC9, 0x0F);
        branch(0xB0, 'nativeFireTick');
        emit(0xBD, 0x66, 0x05, 0x18, 0x69, 0x01, 0xC9, 0x03);
        branch(0x90, 'nativeFireTick');
        emit(0x4C, 0xE1, 0xB9); // Native collision check, then original C/RTS.
        label('nativeFireTick');
        emit(0x4C, 0xC7, 0xB9);
        while(block.base + block.bytes.length < block.limit) emit(0xEA);

        org(0xF300, 0xF380);
        label('queueMirrorAddress');
        emit(0xB9, 0x00, 0x03, 0x49, 0x04, 0x9D, 0x00, 0x03, 0xE8, 0xC8,
             0xB9, 0x00, 0x03, 0x9D, 0x00, 0x03, 0xE8, 0xC8,
             0xB9, 0x00, 0x03, 0x85, 0x00, 0x9D, 0x00, 0x03, 0xE8, 0xC8);
        label('queueMirrorBytes');
        emit(0xB9, 0x00, 0x03, 0x9D, 0x00, 0x03, 0xE8, 0xC8, 0xC6, 0x00);
        branch(0xD0, 'queueMirrorBytes');
        emit(0xB9, 0x00, 0x03);
        branch(0x10, 'queueMirrorAddress');
        emit(0x9D, 0x00, 0x03, 0xE8, 0xC8);
        absolute(0x4C, 'queueScan');

        // Walk every counted segment once, including rejected commands. $00
        // records a non-6 command or an address outside $2000-$2FFF. Return
        // Y=end marker and carry set for rejection, so skipping needs no
        // second parser. Commands 7/8 and mixed palette packets remain intact.
        label('queueNametableCommand');
        emit(0xB9, 0x00, 0x03, 0x49, 0x06, 0x85, 0x00, 0xC8);
        label('queueCheckAddress');
        emit(0xB9, 0x00, 0x03, 0x29, 0xF0, 0xC9, 0x20);
        branch(0xF0, 'queueNextSegment');
        emit(0xE6, 0x00);
        label('queueNextSegment');
        emit(0xC8, 0xC8, 0x98, 0x38, 0x79, 0x00, 0x03, 0xA8,
             0xB9, 0x00, 0x03);
        branch(0x10, 'queueCheckAddress');
        emit(0xA5, 0x00, 0xC9, 0x01, 0x60);

        // State 13 opens and closes the exit using the same four-metatile
        // renderer as stage initialization. Produce that queue first, then
        // reuse the live palette quota: both door pages fit in vblank only
        // when the full palette is deferred to a non-drawing animation frame.
        label('doorAnimation');
        emit(0x20, 0xA5, 0xB7, 0x20, 0x6D, 0xB8);
        absolute(0x20, 'paletteQueueCheck');
        branch(0xB0, 'doorAnimationDone');
        emit(0x4C, 0x20, 0xCA);
        label('doorAnimationDone');
        emit(0x60);

        label('fireQueueCheck');
        emit(0xA5, 0x3D);
        branch(0xD0, 'fireQueueAvailable');
        // One existing metatile plus fire fits; a 38/48-byte fall does not.
        emit(0xA5, 0x1E, 0xC9, 0x11);
        branch(0x90, 'fireQueueAvailable');
        absolute(0x4C, 'fireTickQueue');
        label('fireQueueAvailable');
        emit(0x4C, 0xC7, 0xB9);
        while(block.base + block.bytes.length < block.limit) emit(0xEA);

        // Finalize the producer queue outside the PPU transfer window.
        org(0xF380, 0xF3B0);
        label('queueFinalize');
        emit(0x20, 0xB2, 0x86);
        // The settings page has its own background. Its status text must not
        // be mirrored onto the second gameplay nametable.
        emit(0xA5, 0x2B, 0xC9, PauseSettings.OPEN);
        branch(0xF0, 'queueFinalizeDone');
        emit(0xA5, 0x3D);
        branch(0xD0, 'queueFinalizeDone');
        emit(0xA5, 0x18, 0xC9, 0x04);
        branch(0xD0, 'queueFinalizeDone');
        emit(0xA5, 0x30, 0xE9, 0x08, 0xC9, 0x06); // Include exit animation (13).
        branch(0xB0, 'queueFinalizeDone');
        absolute(0x20, 'queuePrepare');
        label('queueFinalizeDone');
        emit(0xA9, 0x00, 0x60);
        label('queueCommit');
        emit(0x86, 0x1E, 0xA9, 0x00, 0x4C, 0xB2, 0x86);

        // Spread initialization across frames to leave room for both pages.
        org(0xF3B0, 0xF3C0);
        label('initializeEnemySlot');
        // Stage substate $31 is zero on entry to stage state 10. Retain the
        // next native enemy slot there, and finish initialization before
        // advancing to the original fade-in handler. An enemy-9 body draws
        // four metatiles; initializing all eight slots at once can exceed
        // the physical queue when a second page must also be prepared.
        emit(0xA6, 0x31);
        branch(0xD0, 'initializeNextEnemy');
        emit(0xA2, 0x08);
        label('initializeNextEnemy');
        emit(0xCA, 0x20, 0xFB, 0xBC);
        absolute(0x4C, 'initializeEnemyDone');

        // Finish the native enemy initialization before advancing stage state.
        org(0xF3C0, 0xF3D0);
        label('initializeEnemyDone');
        emit(0xA5, 0x31);
        branch(0xD0, 'initializeEnemyWait');
        emit(0x4C, 0x12, 0x8B); // Original INC $30 / RTS.
        label('initializeEnemyWait');
        emit(0x60);
        org(0xF3D0, 0xF3E0);
        label('queuePrepare');
        // $00-$03 are the original producers' temporary scratch bytes. No
        // producer runs after this final queue terminator, before the RTI.
        emit(0xA6, 0x1E, 0xCA, 0x86, 0x01, 0xA0, 0x00);
        absolute(0x4C, 'queueScan');

        org(0xF3E0, 0xF410);
        label('rescueQueueCheck');
        // Original A868 defers a rescue draw when queue length reaches $20.
        // A816 retains $68/$69 at the unprocessed map cell, and advances $6A
        // only after finishing the scan. Reuse that scheduler, allowing one
        // 16-byte metatile packet instead of two when both pages are queued.
        // Reserve fire before rescues, without changing native scan cursors.
        // Both checks return A=queue length and carry without touching X/Y.
        emit(0xA5, 0x3D);
        branch(0xD0, 'originalBackgroundQueue');
        emit(0xA5, 0x1E, 0xC9, 0x10);
        branch(0xB0, 'backgroundQueueDone');
        absolute(0x4C, 'reserveFireQueue');
        label('backgroundQueueDone');
        emit(0x60);
        label('originalBackgroundQueue');
        emit(0xA5, 0x1E, 0xC9, 0x20, 0x60);
        label('fallingQueueCheck');
        emit(0xA5, 0x3D);
        branch(0xD0, 'originalBackgroundQueue');
        emit(0xA5, 0x1E, 0xC9, 0x10, 0x60);
        label('paletteQueueCheck');
        // One metatile plus its second page and 32 colors fits in vblank.
        // A fall can enqueue 38/48 bytes on its own: defer CA20 on those
        // frames and upload the complete current shadow on a quieter frame.
        // CA20's palette-inhibit check and loading/death/ending fades stay intact.
        emit(0xA5, 0x3D);
        branch(0xD0, 'originalPaletteQueue');
        emit(0xA5, 0x1E, 0xC9, 0x11, 0x60);
        label('originalPaletteQueue');
        emit(0xA5, 0x1E, 0xC9, 0x50, 0x60);
        // Erase the retired short-palette helper on load/export too.
        while(block.base + block.bytes.length < block.limit) emit(0xEA);

        resolve();
        for (const part of blocks) {
            patch(part.base, part.bytes);
        }
        const hook = (cpu, opcode, name) => {
            const address = labels.get(name);
            patch(cpu, [opcode, address & 0xFF, address >> 8]);
        };
        hook(0x9B38, 0x4C, 'camera');
        hook(0x838E, 0x20, 'titleReset');
        hook(0x8B4F, 0x4C, 'pause');
        hook(0x8ECE, 0x20, 'attributeIndex');
        hook(0x90B0, 0x20, 'attributeStore');
        hook(0xBBEA, 0x20, 'attributeStore');
        patch(0x886C, [0xE0, 0x06, 0xB0, 0x35]); // Original PPU interpreter.
        hook(0x80C5, 0x20, 'queueFinalize');
        hook(0xB867, 0x4C, 'doorAnimation');
        hook(0x8B0F, 0x4C, 'initializeEnemySlot');
        patch(0xBD39, [0x86, 0x31, 0xCA, 0x60]); // Save native slot, return.
        for(const [cpu, name] of [[0xA507, 'fallingQueueCheck'], [0xA868, 'rescueQueueCheck']]){
            hook(cpu, 0x20, name);
            patch(cpu + 3, [0xEA]); // Replace the fourth byte of LDA/CMP.
        }
        hook(0xA97C, 0x20, 'fireQueueCheck');
        hook(0x8B81, 0x20, 'sceneAnimationQueue');
        patch(0x8B94, [0x20, 0x20, 0xCA]); // Restore original full palette upload.
        hook(0x8B8E, 0x20, 'paletteQueueCheck');
        patch(0x8B91, [0xEA]);
        // Reset before clearing/drawing the next stage's transition screen,
        // rather than waiting for the later STAGE/REST text entry.
        patch(0x8A3A, [0x20, 0x6D, 0xFF]);
        // Both native stage-entry paths still reset scroll before drawing.
        hook(0xFF6D, 0x20, 'stageReset');
        hook(0xFFD4, 0x20, 'stageReset');

        // START/CONTINUE, password entry/validator and their data stay native.

        // Visibility is modulo the MAP width, independently of the view.
        // In single-screen maps high-byte parity must never hide a sprite.
        for(const cpu of [0x9B66, 0xA166, 0xA2B1, 0xA45C, 0xDA04]){
            patch(cpu, [0x25, 0x3D]); // AND levelMode instead of AND #1
        }
        // LOOP VIEW permits pause free-look in either width. The dispatch
        // above retains the original pause for narrow NORMAL VIEW levels.
        patch(0xFEF7, [0xEA, 0xEA, 0xEA, 0xEA, 0xEA]);
        for(const cpu of [0xFF14, 0xFF26, 0xFF4A]) patch(cpu, [0x25, 0x3D]);
        return {selectCamera: labels.get('selectCamera'), pauseMaskBase: 0xF2B0};
    }
}
