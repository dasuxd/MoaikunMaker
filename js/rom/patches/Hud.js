class Hud {
    static configureLevelTimer(romData, enabled = true){
        const bank0RomAddr = (cpuAddr) => 0x10 + (cpuAddr - 0x8000);
        const timerRenderCall = enabled
            ? [0x20, 0xA4, 0xB6]    // JSR $B6A4
            : [0xEA, 0xEA, 0xEA];   // hide timer HUD
        const timerUpdateCall = enabled
            ? [0x20, 0xF3, 0xB6]    // JSR $B6F3
            : [0xEA, 0xEA, 0xEA];   // stop countdown and timeout

        Asm6502.writeBytes(
            romData,
            bank0RomAddr(0x8918),
            timerRenderCall
        );
        Asm6502.writeBytes(
            romData,
            bank0RomAddr(0x8B75),
            timerUpdateCall
        );
    }

    /**
     * Show the number of unreleased Moai as a two-digit HUD value.
     *
     * The original game already maintains the exact live count in $43:
     * initialization counts map tile $0F and rescuing one decrements it. Its
     * two-digit item renderer also has an unused layout mode. Move that mode's
     * coordinates four character cells right to $E0/$E8.
     *
     * The original $96F5-$9704 table is equivalent to:
     *
     *     y < 11 ? 0 : y + $76
     *
     * Replace its lookup with that exact calculation, then reuse the freed
     * sixteen bytes for the second half of the icon renderer. Its seven-byte
     * entry fits in verified fixed-bank padding at $FF79-$FF7F. This preserves
     * both movement lookup results instead of overwriting them as the previous
     * $96EB helper did.
     */
    static addRemainingRescueCountHud(
        romData,
        useTimerPosition = false
    ){
        const bank0RomAddr = (cpuAddr) => 0x10 + (cpuAddr - 0x8000);
        const fixedBankShift = 0x18000;
        const fixedBankRomAddr = (cpuAddr) =>
            0x4010 + (cpuAddr - 0xC000) + fixedBankShift;
        const hudIconRendererEntryCpuAddr = 0xFF79;
        const hudIconRendererBodyCpuAddr = 0x96F5;
        const timerPositionIconRendererCpuAddr = 0xB6A4;
        const remainingCountWrapperCpuAddr = 0xB760;
        const remainingCountTailCpuAddr = 0xFFE1;
        const remainingCountY = useTimerPosition ? 0x07 : 0x18;
        const remainingIconRendererCpuAddr = useTimerPosition
            ? timerPositionIconRendererCpuAddr
            : hudIconRendererEntryCpuAddr;
        const remainingDigitX = useTimerPosition
            ? [0xA8, 0xB0]
            : [0xE0, 0xE8];

        /**
         * CPU $96A3-$96AC: preserve the original $96F5,Y table exactly while
         * freeing its sixteen data bytes for executable code.
         *
         * CMP leaves carry set for Y >= 11, so ADC #$75 produces Y + $76.
         * Values below 11 take the original early-return path at $96E4.
         */
        Asm6502.writeBytes(romData, bank0RomAddr(0x96A3), [
            0xA5, 0xC2,             // LDA playerYLow
            0x29, 0x0F,             // AND #$0F
            0xC9, 0x0B,             // CMP #11
            0x90, 0x39,             // BCC $96E4
            0x69, 0x75,             // ADC #$75 => Y + $76
        ]);

        Asm6502.writeBytes(romData, bank0RomAddr(0x891B), [
            0x20,
            remainingCountWrapperCpuAddr & 0xFF,
            (remainingCountWrapperCpuAddr >> 8) & 0xFF,
        ]);

        /**
         * CPU $B758-$B76E: original item icon plus remaining-count wrapper.
         */
        Asm6502.writeBytes(romData, bank0RomAddr(0xB758), [
            0xA9, 0x07,             // originalIcon: LDA #$07
            0xA0, 0x01,             // LDY #itemPalette
            0x20,
            hudIconRendererEntryCpuAddr & 0xFF,
            (hudIconRendererEntryCpuAddr >> 8) & 0xFF,
            0x60,                   // RTS

            0x20, 0x2A, 0xB7,       // wrapper: JSR $B72A (original item HUD)
            0xA9, remainingCountY,  // LDA #remainingCountY
            0xA0, 0x00,             // LDY #playerPalette
            0x20,
            remainingIconRendererCpuAddr & 0xFF,
            (remainingIconRendererCpuAddr >> 8) & 0xFF,
            0x4C, 0xE1, 0xFF,       // JMP prepareRemainingCount
            0xEA, 0xEA,             // padding before $B76F
        ]);

        Asm6502.writeBytes(
            romData,
            fixedBankRomAddr(hudIconRendererEntryCpuAddr),
            [
                0x9D, 0x00, 0x02,       // STA OAM Y
                0x98,                   // TYA
                0x4C,
                hudIconRendererBodyCpuAddr & 0xFF,
                (hudIconRendererBodyCpuAddr >> 8) & 0xFF,
            ]
        );
        Asm6502.writeBytes(
            romData,
            bank0RomAddr(hudIconRendererBodyCpuAddr),
            [
                0x9D, 0x02, 0x02,       // STA OAM attributes/palette
                0xA9, 0xE8,             // LDA #round icon tile
                0x9D, 0x01, 0x02,       // STA OAM tile
                0xA9, 0xD0,             // LDA #item-area icon X
                0x9D, 0x03, 0x02,       // STA OAM X
                0x4C, 0x9B, 0xB7,       // JMP $B79B (consume OAM slot)
            ]
        );

        if(useTimerPosition){
            /**
             * With the timer disabled, its renderer at $B6A4 is unreachable.
             * Reuse its first 20 bytes for a dedicated X=$98 icon renderer so
             * the original item icon can remain at X=$D0.
             */
            Asm6502.writeBytes(
                romData,
                bank0RomAddr(timerPositionIconRendererCpuAddr),
                [
                    0x9D, 0x00, 0x02,       // STA OAM Y
                    0xA9, 0xE8,             // LDA #round icon tile
                    0x9D, 0x01, 0x02,       // STA OAM tile
                    0x98,                   // TYA
                    0x9D, 0x02, 0x02,       // STA OAM attributes/palette
                    0xA9, 0x98,             // LDA #timer-area icon X
                    0x9D, 0x03, 0x02,       // STA OAM X
                    0x4C, 0x9B, 0xB7,       // JMP $B79B
                ]
            );
        }

        Asm6502.writeBytes(
            romData,
            fixedBankRomAddr(remainingCountTailCpuAddr),
            [
                0xA9, 0x03,             // LDA #$03 (aligned $E0/$E8 layout)
                0x85, 0x10,             // STA HUD number layout
                0xA5, 0x43,             // LDA remaining rescue count
                0xC9, 0x64,             // CMP #100
                0x90, 0x02,             // BCC draw
                0xA9, 0x63,             // LDA #99 (display saturation)
                0x4C, 0x33, 0xB7,       // JMP $B733 (shared 2-digit renderer)
            ]
        );

        Asm6502.writeBytes(romData, fixedBankRomAddr(0xC3CD), [
            ...remainingDigitX,
        ]);

        Asm6502.writeBytes(
            romData,
            bank0RomAddr(0xB793),
            [remainingCountY]
        );
    }
}
