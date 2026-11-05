class Credits {
    /**
     * Append a text page after all six native staff entries, before KONAMI.
     * $B5=4 is the native logo phase. Its $BC=0 entry shows our page first;
     * $BC=5 waits on the existing $BD timer, then enters native $C914.
     * Native logo substates 1–4, staff data, music and ending animation stay
     * untouched. Fixed bank 7 $F800–$F93F holds the credit code/text;
     * bank 1 $A500–$A83F holds both fonts after the pause-pattern assets.
     * Bird motion follows at $F940; the pause-pattern worker starts at $FC80.
     * coordinate/flight helpers end at $F800; pause helpers start at $FED9.
     */
    static configureCustomLevelCredit(romData, value) {
        const file = cpu => cpu - 0x8000 + 0x10 + (0x18000);
        const fontFile = 0x6510;
        const author = GameSettings.normalizeCustomLevelAuthor(value).trim().toUpperCase();
        if (!author) return;
        const base = 0xF800, limit = 0xF940;
        if (romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved ending-credit area in bank 7 is occupied');

        const text = [];
        const columns = GameSettings.CREDIT_SCREEN_WIDTH / GameSettings.CREDIT_GLYPH_WIDTH;
        const row = (line, value, font = 0x0B) => {
            const address = 0x2000 + line * columns + Math.floor((columns - value.length) / 2);
            text.push(0x06, address >> 8, address & 0xFF, value.length,
                ...Array.from(value, letter => letter === ' ' ? 0 : font + letter.charCodeAt(0) - 0x41), 0xFF);
        };
        row(7, 'THANKS TO KONAMI');
        row(9, 'FOR CREATING MOAI KUN');
        row(14, 'CUSTOM LEVELS DESIGNED BY');
        row(16, author, 0x80);
        row(21, 'CREATED WITH');
        row(23, 'MOAI KUN MAKER', 0x80);

        // The original staff names use centered 8px glyphs in 8x16 sprite
        // tiles ($16/$17 = A, $18/$19 = B, ...). Move their eight visible
        // rows into background tiles $80–$99, so even a 28-letter name is
        // complete without the NES's eight-sprites-per-scanline limit.
        const font = [];
        for (let letter = 0; letter < 26; letter++) {
            const source = 0x8010 + (0x16 + letter * 2) * 16;
            const ink = Array.from({length:8}, (_, y) => {
                const nativeY = y + 4;
                const at = source + (nativeY >> 3) * 16 + (nativeY & 7);
                // Native sprite palette 2 draws index 2 white and index 3
                // black. Preserve the visible white strokes, not the black
                // cutouts inside them, when remapping to background ink.
                return romData[at + 8] & ~romData[at];
            });
            // Palette index 2 is the native ending's white foreground.
            font.push(...Array(8).fill(0), ...ink);
        }
        const originalFont = romData.slice(0x9810, 0x9810 + font.length);

        const {bytes, labels, emit, label, absolute, branch, resolve} = Asm6502.block(base, limit);
        const loadFont = pointer => {
            emit(0xA9, pointer & 255, 0x85, 0x00, 0xA9, pointer >> 8, 0x85, 0x01);
            absolute(0x20, 'uploadFont');
        };

        emit(0xA5, 0xBC);                // LDA logo substate
        branch(0xF0, 'show');             // BEQ show our page
        emit(0xC9, 0x05);
        branch(0xF0, 'resume');           // BEQ resume original logo setup
        emit(0x20, 0x0D, 0x83);          // Native indexed dispatch
        emit(0x14, 0xC9, 0x26, 0xC9, 0xC0, 0xC9, 0xC8, 0xC9, 0xD0, 0xC9);

        label('show');
        emit(0x20, 0xB9, 0x83,          // Clear background (native)
             0x20, 0xED, 0x89,          // Hide ending entities (native)
             0xA9, 0x00, 0x85, 0x2F,   // Keep native ending graphics bank 0
             0xA9, 0x00, 0x85, 0xFC,   // No vertical scroll on our text page
             0x20, 0x60, 0xFF,          // Shared camera reset, also for wide maps
             // Bank 0's $1000 pattern table contains the complete A–Z font.
             // Its $0000 ending font omits several letters. Entities are hidden.
             0xA5, 0xFF, 0x29, 0xE0, 0x09, 0x10, 0x85, 0xFF,
             0xA0, 0x22, 0x20, 0x26, 0xD6); // Native ending palette
        loadFont(0xA500);
        emit(0xA6, 0x1E, 0xA0, 0x00);  // Append to native VRAM queue
        label('copy');
        absolute(0xB9, 'text');           // LDA text,Y
        emit(0x9D, 0x00, 0x03, 0xE8, 0xC8, 0xC0, text.length);
        branch(0xD0, 'copy');
        emit(0x86, 0x1E,
             0xA9, 0xE1, 0x85, 0xBD,   // 225 ticks × 4 frames = fifteen seconds
             0xA9, 0x05, 0x85, 0xBC, 0x60);
        label('resume');
        loadFont(0xA500 + font.length);       // Restore CHR RAM before native logo/title
        emit(0xA5, 0xFF, 0x29, 0xE0, 0x09, 0x08, 0x85, 0xFF, // Native pattern tables
             0xA9, 0x00, 0x85, 0xBC, 0x4C, 0x14, 0xC9);

        label('uploadFont');
        // Use native rendering/NMI suspension for a bounded 416-byte upload.
        // Code stays fixed while bank 1 supplies the font; restore executable
        // bank 0 before the native routine enables rendering and NMI again.
        emit(0x20, 0x2D, 0x81,
             0xA9, 0x01, 0x8D, 0x00, 0x80,
             0xA9, 0x18, 0x8D, 0x06, 0x20, 0xA9, 0x00, 0x8D, 0x06, 0x20,
             0xA0, 0x00);
        label('fontPage');
        emit(0xB1, 0x00, 0x8D, 0x07, 0x20, 0xC8);
        branch(0xD0, 'fontPage');
        emit(0xE6, 0x01);
        label('fontTail');
        emit(0xB1, 0x00, 0x8D, 0x07, 0x20, 0xC8, 0xC0, 0xA0);
        branch(0xD0, 'fontTail');
        emit(0xA9, 0x00, 0x8D, 0x00, 0x80, 0x4C, 0x0C, 0x81);
        label('text');
        emit(...text);
        resolve();
        romData.set(font, fontFile);
        romData.set(originalFont, fontFile + font.length);
        Asm6502.writeBytes(romData, file(base), bytes);
        Asm6502.writeBytes(romData, file(0xC905), [0x4C, base & 0xFF, base >> 8, 0xEA, 0xEA]);
    }

    static addMoaikunMakerLabel(romData){
        const labelCode = [0xE3, 0xE2, 0x17, 0x0B, 0x0E, 0x0F, 0xE3, 0x21, 0x13, 0x1E, 0x12, 0xE2, 0xE3, 0xE2, 0xE3, 0xE2, 0xE3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0x17, 0x19, 0x0B, 0x13, 0x15, 0x1F, 0x18, 0xD2, 0x17, 0x0B, 0x15, 0x0F, 0x1C];
        const labelAddr = 0x05D9;
        for(let i = labelAddr; i< labelAddr + labelCode.length; i++){
            romData[i] = labelCode[i - labelAddr];
        }
    }
}
