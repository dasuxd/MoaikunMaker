class Camera {
    /**
     * CPU $AC71: enemy 5's active flight calls the shared boundary checker
     * at $AC48, which removes it near either horizontal map edge. Enter the
     * existing vertical-only check at $AC5C instead. The following native
     * $AFB0 movement already wraps X by $3D (256/512 pixels), as for enemy 11.
     * Preserve the upper/lower limits, damage states and other enemies' calls
     * to the complete boundary checker. Bank 0 is shared by both ROM formats.
     */
    static fixBatHorizontalWrap(romData){
        Asm6502.writeBytes(romData, 0xAC72 - 0x8000 + 0x10, [0x5C]);
    }

    /**
     * Turn a 32-column level into a seamless 512-pixel horizontal ring.
     *
     * The background already occupies the two physical horizontal nametables,
     * and the player/enemy world coordinates already wrap at 0/$1FF. The
     * missing piece is a ninth camera bit. In wide mode this patch computes:
     *
     *     cameraX = (playerWorldX - $80) & $1FF
     *
     * $FD remains the low camera byte. The otherwise-unused $9D becomes its
     * page bit and is copied to PPUCTRL/$FF bit 0. Single-screen levels keep
     * camera $000 and retain their original 256-pixel wrapping behavior.
     *
     * Sprite visibility uses the low bit of the complete high-byte subtraction:
     *
     *     ((objectWorldX - cameraX) >> 8) & 1
     *
     * Zero is inside the current 256-pixel viewport. This parity test is
     * required at the $1FF/$000 seam, where a normal 16-bit subtraction can
     * produce $FE even though the object is visibly just to the right.
     * addViewModes() subsequently selects the camera and visibility mask from
     * the title choice and map width.
     */
    static fixWideScreenLoopingCamera(romData){
        const bank0RomAddr = (cpuAddr) => 0x10 + (cpuAddr - 0x8000);
        const fixedBankShift = 0x18000;
        const fixedBankRomAddr = (cpuAddr) =>
            0x4010 + (cpuAddr - 0xC000) + fixedBankShift;
        const patchBank0 = (cpuAddr, bytes) =>
            Asm6502.writeBytes(romData, bank0RomAddr(cpuAddr), bytes);

        const resetCameraCpuAddr = 0xFF60;
        const mainTitleResetCpuAddr = 0xFF6D;
        const endingResetCpuAddr = 0xFF73;
        // Expansion loaders end at $F0D1; the bank-safe NMI starts at $F0E2.
        // $FF79-$FF7F belongs to the rescue HUD and must remain untouched.
        const gameOverResetCpuAddr = 0xF0D2;

        /**
         * CPU $FF60-$FF78: shared non-gameplay camera reset and two wrappers.
         *
         * The original global RAM clear reaches $9D but stops before $FD/$FF.
         * Consequently, interrupting an attract-mode demo can enter the main
         * title with PPUCTRL still selecting nametable $24. The ending state
         * has the same problem when the last wide level finishes on page 1.
         *
         * Keep the camera-only helper independent from $2F: the stage-title
         * wrapper owns that original graphics-bank write, while the ending
         * must preserve its own $2F value.
         */
        Asm6502.writeBytes(romData, fixedBankRomAddr(resetCameraCpuAddr), [
            0xA9, 0x00,             // resetCamera: LDA #$00
            0x85, 0xFD,             // STA cameraXLow
            0x85, 0x9D,             // STA cameraXHigh
            0xA5, 0xFF,             // LDA PPUCTRL shadow
            0x29, 0xFE,             // AND #$FE
            0x85, 0xFF,             // STA PPUCTRL shadow
            0x60,                   // RTS

            0x20, 0x60, 0xFF,       // mainTitleReset: JSR resetCamera
            0x4C, 0x2E, 0xDA,       // JMP original main-title initializer

            0x20, 0x60, 0xFF,       // endingReset: JSR resetCamera
            0x4C, 0xE8, 0xC5,       // JMP original ending-state handler
        ]);

        Asm6502.writeBytes(romData, fixedBankRomAddr(gameOverResetCpuAddr), [
            0x20, 0x60, 0xFF,       // JSR resetCamera
            0x4C, 0xB9, 0x83,       // JMP original game-over setup
        ]);

        // $8C10 is death substate 3: clear the stage before consuming a life
        // and eventually drawing CONTINUE/PASSWORD. $8C7E is the later password
        // display, not the menu entry. Reset BEFORE either native screen setup,
        // regardless of whether runtime UP switching is enabled.
        for(const cpu of [0x8C10, 0x8C7E]){
            patchBank0(cpu, [0x20, gameOverResetCpuAddr & 0xFF, gameOverResetCpuAddr >> 8]);
        }

        // Main title: reset before its first background/graphics setup call.
        patchBank0(0x838E, [
            0x20,
            mainTitleResetCpuAddr & 0xFF,
            (mainTitleResetCpuAddr >> 8) & 0xFF,
        ]);

        // Main state $0F: keep page 0 selected throughout the ending sequence.
        patchBank0(0x8A35, [
            endingResetCpuAddr & 0xFF,
            (endingResetCpuAddr >> 8) & 0xFF,
        ]);

        /**
         * A retry can enter the stage-title screen while the previous life
         * still has camera page 1 selected. The title is written only to
         * nametable $20, so reset both camera bytes and PPUCTRL's page bit at
         * the title's common main-state/substate-0 entry.
         *
         * The wrapper also performs the original `LDA #$00 / STA $2F` setup
         * replaced by its JSR. It returns to $8A64, immediately before the
         * title's original drawing code.
         */
        patchBank0(0x8A60, [0x20, 0xD0, 0xFF, 0xEA]);
        Asm6502.writeBytes(romData, fixedBankRomAddr(0xFFD0), [
            0xA9, 0x00,             // LDA #$00
            0x85, 0x2F,             // STA original title-state field
            0x20, 0x60, 0xFF,       // JSR resetCamera
            0xA9, 0x00,             // restore original accumulator result
            0x60,                   // RTS
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
        ]);

        /**
         * CPU $8B4F and $FED9-$FF5F: paused wide-map free-look.
         *
         * The original active-game loop returns at $8B53 whenever $32 is
         * nonzero. Tail-jump through the helper instead:
         *
         * - a paused wide-map frame with Left/Right held changes the existing
         *   9-bit camera by four pixels modulo $200;
         * - metasprite slots $0401-$041D are cleared, leaving only player slot
         *   $0400, whose X and visibility are projected against the free camera;
         * - $6E is cleared so the OAM builder omits its extra HUD sprites;
         * - calling $88D3 immediately rebuilds OAM before the next NMI applies
         *   the new scroll, preventing one frame of stale non-player sprites;
         * - a paused frame without a direction preserves the selected view;
         * - resuming restores $6E and uses one sprite-hidden transition frame
         *   while normal gameplay rebuilds every metasprite and recenters.
         */
        patchBank0(0x8B4F, [0x4C, 0xD9, 0xFE]);
        Asm6502.writeBytes(romData, fixedBankRomAddr(0xFED9), [
            0xA5, 0x32,             // LDA pauseFlag
            0xD0, 0x1A,             // BNE paused
            0xA5, 0x6E,             // unpaused: LDA extraSpriteEnable
            0xD0, 0x0D,             // BNE normalFrame
            0xA9, 0x01,             // first frame after free-look
            0x85, 0x6E,             // restore extra Sprite groups
            0xA5, 0xFE,             // LDA PPUMASK shadow
            0x29, 0xEF,             // keep Sprites hidden for one rebuild frame
            0x85, 0xFE,             // STA PPUMASK shadow
            0x4C, 0x54, 0x8B,       // JMP original active update
            0xA5, 0xFE,             // normalFrame: LDA PPUMASK shadow
            0x09, 0x10,             // ORA #showSprites
            0x85, 0xFE,             // STA PPUMASK shadow
            0x4C, 0x54, 0x8B,       // JMP original active update

            0xA5, 0x3D,             // paused: LDA levelMode
            0x4A,                   // LSR A (carry = wide flag)
            0x90, 0x63,             // BCC done
            0xA5, 0xF6,             // LDA held controller buttons
            0x29, 0x03,             // AND #(Left | Right)
            0xF0, 0x5D,             // BEQ done
            0xC9, 0x03,             // CMP #(Left | Right)
            0xF0, 0x59,             // BEQ done
            0x4A,                   // LSR A (carry set = Right)
            0xB0, 0x12,             // BCS moveRight

            0x38,                   // moveLeft: SEC
            0xA5, 0xFD,             // LDA cameraXLow
            0xE9, 0x04,             // SBC #$04
            0x85, 0xFD,             // STA cameraXLow
            0xA5, 0x9D,             // LDA cameraXHigh
            0xE9, 0x00,             // SBC #$00
            0x29, 0x01,             // AND #$01
            0x85, 0x9D,             // STA cameraXHigh
            0x4C, 0x2A, 0xFF,       // JMP updatePpuPage

            0x18,                   // moveRight: CLC
            0xA5, 0xFD,             // LDA cameraXLow
            0x69, 0x04,             // ADC #$04
            0x85, 0xFD,             // STA cameraXLow
            0xA5, 0x9D,             // LDA cameraXHigh
            0x69, 0x00,             // ADC #$00
            0x29, 0x01,             // AND #$01
            0x85, 0x9D,             // STA cameraXHigh

            0xA5, 0xFF,             // updatePpuPage: LDA PPUCTRL shadow
            0x29, 0xFE,             // AND #$FE
            0x05, 0x9D,             // ORA cameraXHigh
            0x85, 0xFF,             // STA PPUCTRL shadow

            0xA9, 0x00,             // LDA #$00
            0x85, 0x6E,             // suppress extra OAM Sprite groups
            0xA2, 0x1D,             // LDX #last non-player metasprite slot
            0x9D, 0x00, 0x04,       // clearSlots: STA metaspriteId,X
            0xCA,                   // DEX
            0xD0, 0xFA,             // BNE clearSlots (preserve slot 0)

            0x38,                   // SEC
            0xA5, 0xC2,             // LDA playerXLow
            0xE5, 0xFD,             // SBC cameraXLow
            0x8D, 0x3C, 0x04,       // STA playerScreenX
            0xA5, 0xC1,             // LDA playerXHigh
            0xE5, 0x9D,             // SBC cameraXHigh
            0x29, 0x01,             // AND #$01
            0xD0, 0x08,             // BNE hidePlayer
            0xA9, 0x02,             // fixed standing-player metasprite
            0x8D, 0x00, 0x04,       // STA playerMetasprite
            0x4C, 0x5B, 0xFF,       // JMP rebuildOam
            0xA9, 0x00,             // hidePlayer: LDA #$00
            0x8D, 0x00, 0x04,       // STA playerMetasprite
            0x20, 0xD3, 0x88,       // rebuildOam: JSR OAM builder
            0x60,                   // RTS
            0x60,                   // done: RTS
        ]);

        /**
         * CPU $9B38-$9B61: centered 9-bit camera.
         *
         * Stage states 0-2 include the title/loading interval and always use
         * nametable $20. State 3 is live gameplay and may use the centered
         * wide-map camera. Updating $FF here is enough because the NMI already
         * writes it to $2000 after writing $FD to horizontal PPUSCROLL.
         */
        patchBank0(0x9B38, [
            0xA5, 0x56,             // LDA stageState
            0xC9, 0x03,             // CMP #liveGameplay
            0xD0, 0x15,             // BNE resetCamera
            0xA5, 0x3D,             // LDA levelMode
            0x4A,                   // LSR A (carry = wide flag)
            0x90, 0x10,             // BCC resetCamera
            0xA5, 0xC2,             // wide: LDA playerXLow (carry is already set)
            0xE9, 0x80,             // SBC #$80
            0x85, 0xFD,             // STA cameraXLow
            0xA5, 0xC1,             // LDA playerXHigh
            0xE9, 0x00,             // SBC #$00
            0x29, 0x01,             // AND #$01
            0x85, 0x9D,             // STA cameraXHigh
            0x10, 0x06,             // BPL updatePpuPage (always)
            0xA9, 0x00,             // resetCamera: LDA #$00
            0x85, 0xFD,             // STA cameraXLow
            0x85, 0x9D,             // STA cameraXHigh
            0xA5, 0xFF,             // updatePpuPage: LDA PPUCTRL shadow
            0x29, 0xFE,             // AND #$FE
            0x05, 0x9D,             // ORA cameraXHigh
            0x85, 0xFF,             // STA PPUCTRL shadow
            0x60,                   // RTS
        ]);

        /**
         * CPU $9B62-$9B93 was an unreferenced alternate camera routine.
         * No JSR/JMP/table pointer in the original ROM targets it.
         *
         * $9B62: high-byte parity helper for a world high byte in scratch $01.
         * $9B64: shared high-byte parity helper for a world high byte in A.
         * $9B69: project the three temporary falling/special objects.
         * $9B78: project a normal enemy.
         * $9B87: hide a temporary object's metasprite.
         * $9B8D: normalize the player's 9-bit world X using level mode.
         */
        patchBank0(0x9B62, [
            0xA5, 0x01,             // scratchHigh: LDA $01
            0xE5, 0x9D,             // finishHigh: SBC cameraXHigh
            0x29, 0x01,             // AND #$01
            0x60,                   // RTS

            0x38,                   // projectTemporary: SEC
            0xBD, 0xF8, 0x04,       // LDA temporaryXLow,X
            0xE5, 0xFD,             // SBC cameraXLow
            0x9D, 0x4E, 0x04,       // STA temporaryScreenX,X
            0xBD, 0xF5, 0x04,       // LDA temporaryXHigh,X
            0x4C, 0x64, 0x9B,       // JMP finishHigh

            0x38,                   // projectEnemy: SEC
            0xBD, 0x16, 0x05,       // LDA enemyXLow,X
            0xE5, 0xFD,             // SBC cameraXLow
            0x9D, 0x51, 0x04,       // STA enemyScreenX,X
            0xBD, 0x0E, 0x05,       // LDA enemyXHigh,X
            0x4C, 0x64, 0x9B,       // JMP finishHigh

            0xA9, 0x00,             // hideTemporary: LDA #$00
            0x9D, 0x12, 0x04,       // STA temporaryMetasprite,X
            0x60,                   // RTS

            0xA5, 0xC1,             // normalizePlayerX: LDA playerXHigh
            0x25, 0x3D,             // AND levelMode (valid values are 0/1)
            0x85, 0xC1,             // STA playerXHigh
            0x60,                   // RTS
        ]);

        // CPU $943C: player projection and damage-blink visibility.
        patchBank0(0x943C, [
            0xA5, 0xD3,             // LDA blinkTimer
            0xF0, 0x06,             // BEQ project
            0xC6, 0xD3,             // DEC blinkTimer
            0x29, 0x04,             // AND #$04
            0xD0, 0x0F,             // BNE hide
            0x38,                   // project: SEC
            0xA5, 0xC2,             // LDA playerXLow
            0xE5, 0xFD,             // SBC cameraXLow
            0x8D, 0x3C, 0x04,       // STA playerScreenX
            0xA5, 0xC1,             // LDA playerXHigh
            0x20, 0x64, 0x9B,       // JSR finishHigh
            0xF0, 0x05,             // BEQ done
            0xA9, 0x00,             // hide: LDA #$00
            0x8D, 0x00, 0x04,       // STA playerMetasprite
            0x60,                   // done: RTS
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
        ]);

        // Redirect every original $945A player-X normalizer call/jump.
        for(const callerCpuAddr of [0x941D, 0x9857, 0x986D, 0x98AE, 0x9991]){
            patchBank0(callerCpuAddr + 1, [0x8D, 0x9B]);
        }

        // CPU $A15B: door/spring-like singleton projection.
        patchBank0(0xA15B, [
            0xA5, 0x8D, 0xE5, 0xFD, 0x8D, 0x59, 0x04,
            0xA5, 0x8C, 0xE5, 0x9D, 0x29, 0x01,
            0xD0, 0x04, 0xA9, 0x16, 0xD0, 0x02, 0xA9, 0x00,
            0x8D, 0x1D, 0x04, 0x60,
        ]);

        // CPU $A2A3: object projection; preserve carry as its return status.
        patchBank0(0xA2A3, [
            0x38, 0xBD, 0x90, 0x04, 0xE5, 0xFD, 0x9D, 0x3D, 0x04,
            0xBD, 0x84, 0x04, 0xE5, 0x9D, 0x29, 0x01, 0xD0, 0x06,
            0xAD, 0x90, 0xC3, 0x18, 0x90, 0x03,
            0xA9, 0x00, 0x38, 0x9D, 0x01, 0x04, 0x60,
        ]);

        // CPU $A405/$A442: two sub-sprites use the high byte in scratch $01.
        patchBank0(0xA405, [0x20, 0x62, 0x9B, 0xF0, 0x06, 0xEA]);
        patchBank0(0xA442, [0x20, 0x62, 0x9B, 0xF0, 0x06, 0xEA]);

        // CPU $A44E: paired/special object projection.
        patchBank0(0xA44E, [
            0x38, 0xBD, 0xB0, 0x04, 0xE5, 0xFD, 0x9D, 0x49, 0x04,
            0xBD, 0xAC, 0x04, 0xE5, 0x9D, 0x29, 0x01, 0xD0, 0x0A,
            0xBC, 0xB8, 0x04, 0xB9, 0x77, 0xC3, 0x9D, 0x0D, 0x04, 0x60,
            0xA9, 0x00, 0x9D, 0x0D, 0x04, 0x60, 0xEA, 0xEA, 0xEA,
        ]);

        // CPU $A780: temporary/falling objects previously ignored X high.
        patchBank0(0xA780, [
            0x20, 0x69, 0x9B,       // JSR projectTemporary
            0xD0, 0x0D,             // BNE hide
            0xBD, 0xB4, 0xC3,
            0x9D, 0x12, 0x04,
            0xBD, 0xB7, 0xC3,
            0x9D, 0x6C, 0x04,
            0x60,
            0x4C, 0x87, 0x9B,       // hide: JMP hideTemporary
            0xEA,
        ]);

        // CPU $AE54: normal-enemy projection.
        patchBank0(0xAE54, [
            0x20, 0x78, 0x9B,       // JSR projectEnemy
            0xF0, 0x05,             // BEQ done
            0xA9, 0x00,
            0x9D, 0x15, 0x04,
            0x60,                   // done: RTS
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
        ]);

        /**
         * Replace the moving-rock projection installed by
         * fixWideScreenRockPushBug(). Single-screen rock high bytes are already
         * normalized to zero, so this unified parity test preserves their
         * original opposite-edge wrapping.
         */
        patchBank0(0x9E3D, [0x20, 0xF8, 0xD9]);
        Asm6502.writeBytes(romData, fixedBankRomAddr(0xD9F8), [
            0x38, 0xA5, 0xDE, 0xE5, 0xFD, 0x8D, 0x4E, 0x04,
            0xA5, 0xDD, 0xE5, 0x9D, 0x29, 0x01, 0xF0, 0x05,
            0xA9, 0x00, 0x8D, 0x12, 0x04, 0x60,
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
        ]);
    }
}
