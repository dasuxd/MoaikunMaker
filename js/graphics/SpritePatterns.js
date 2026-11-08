class SpritePatterns {
    // Clu Clu Land (World), CHR $150-$15F / file $5510-$560F.
    // Four 16x16 frames, in row-major tile order; see notes/PORTAL_ART.md.
    static PORTAL_CHR_HEX =
        '1f306fd8b3a4a9aa00000f1f3c383133f80cf61bcd2595550000f0f83c1c8cccaaa9a4b3d86f301f3331383c1f0f0000559525cd1bf60cf8cc8c1c3cf8f00000' +
        '1f3f70e7ccdbd6d5000000070f1c1819f8fc0ee733db6bab000000e0f0381898d5d6dbcce7703f1f19181c0f07000000ab6bdb33e70efcf8981838f0e0000000' +
        '1f306fd8b3a4a9aa000f102043474e4cf80cf61bcd25955500f00804c2e27232aaa9a4b3d86f301f4c4e474320100f00559525cd1bf60cf83272e2c20408f000' +
        '1f3f70e7ccdbd6d5000f1f3870636766f8fc1ecf27d36bab00f0f83c1ecee666d5d6dbcce7703f1f66676370381f0f00ab6bdb33e70efcf866e6c60e1cf8f000';
    static PORTAL_FRAMES = Object.freeze(Array.from({length: 6}, (_, frame) =>
        Object.freeze([0, 2, 1, 3].map(tile =>
            GraphicsCatalog.SCENE_GRAPHICS_LAYOUT.portalEntryStart + frame * 4 + tile))));

    static getPortalFrameTiles(group, frame) {
        if (frame === 6) {
            const left = [0xBA, 0xBC, 0xBE, 0xFC][group];
            return [left, 0xFE, left + 1, 0xFF];
        }
        const base = GraphicsCatalog.SCENE_GRAPHICS_LAYOUT.portalEntryStart;
        const left = base + (group === 0 ? frame * 4 : 24 + (group - 1) * 12 + frame * 2);
        const right = base + frame * 4 + 2;
        return [left, right, left + 1, right + 1];
    }

    /** Use native palettes only; group 1 retains the original portal color. */
    static getPortalColorSchemes(romData, scene) {
        const shift = romData.length > 0x10010 ? 0x18000 : 0;
        const pointer = 0x564D + shift + scene * 2;
        const start = (romData[pointer] | romData[pointer + 1] << 8) - 0x8000 + 16 + shift;
        const palette = Array.from({length: 32}, (_, i) => romData[start + i] ?? 0x0F);
        const rgb = i => GraphicsCatalog.NES_PALETTE[palette[i] & 63];
        const distance = (a, b) => rgb(a).reduce((sum, value, channel) => sum + (value - rgb(b)[channel]) ** 2, 0);
        let first = 0, best = Infinity;
        for (let bg = 0; bg < 4; bg++) {
            const score = distance(bg * 4 + 1, 25) + distance(bg * 4 + 2, 26);
            if (score < best) { first = bg; best = score; }
        }
        const backgrounds = [first];
        while (backgrounds.length < 4) {
            let next = -1, contrast = -1;
            for (let bg = 0; bg < 4; bg++) if (!backgrounds.includes(bg)) {
                const score = Math.min(...backgrounds.map(previous =>
                    distance(bg * 4 + 1, previous * 4 + 1) + distance(bg * 4 + 2, previous * 4 + 2)));
                if (score > contrast) { next = bg; contrast = score; }
            }
            backgrounds.push(next);
        }
        // Select the closest assignment of the remaining sprite palettes.
        // Some scenes duplicate colors; the baked group numeral stays unique.
        let sprites = [2, 0, 1, 3]; best = Infinity;
        for (const a of [0, 1, 3]) for (const b of [0, 1, 3]) if (a !== b) {
            const candidate = [2, a, b, [0, 1, 3].find(c => c !== a && c !== b)];
            const score = candidate.reduce((sum, sprite, group) => sum
                + distance(backgrounds[group] * 4 + 1, 16 + sprite * 4 + 1)
                + distance(backgrounds[group] * 4 + 2, 16 + sprite * 4 + 2), 0);
            if (score < best) { best = score; sprites = candidate; }
        }
        // The same CHR is used for the background and for the overlay. Pick
        // two opaque inks whose worst contrast is best across both paths.
        const luminance = palette.map(color => {
            const linear = GraphicsCatalog.NES_PALETTE[color & 63].map(value => {
                const s = value / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return 0.05 + linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        });
        const contrast = (a, b) => Math.max(luminance[a], luminance[b]) / Math.min(luminance[a], luminance[b]);
        const schemes = backgrounds.map((background, group) => {
            const sprite = sprites[group], bg = background * 4, sp = 16 + sprite * 4;
            // Native palette 3 cycles three inks in scene 0 and swaps two in scene 4.
            const phases = [[0, 1, 2, 3]];
            if (background === 3 && scene === 0) phases.push([0, 2, 3, 1], [0, 3, 1, 2]);
            if (background === 3 && scene === 4) phases.push([0, 2, 1, 3]);
            let bestContrast = 0, badgeInk, badgePaper;
            for (const [ink, paper] of [[2, 3], [1, 3], [2, 1]]) {
                const score = Math.min(contrast(sp + ink, sp + paper),
                    ...phases.map(phase => contrast(bg + phase[ink], bg + phase[paper])));
                if (score > bestContrast) { bestContrast = score; badgeInk = ink; badgePaper = paper; }
            }
            return {background, sprite, badgeInk, badgePaper};
        });
        // Move the second color scheme (which can cycle) to portal 4.
        return [schemes[0], schemes[3], schemes[2], schemes[1]];
    }

    static getPortalBasePatterns() {
        const source = Uint8Array.from(SpritePatterns.PORTAL_CHR_HEX.match(/../g), byte => parseInt(byte, 16));
        const patterns = new Uint8Array(24 * 16);
        // Native white is index 1; the exit sprite palette highlights index 2.
        // Keep the two moving rings (1 <-> 2). Both kinds of gap in the
        // source (0 and 3) take opaque ink 3 inside the rounded silhouette.
        // Reorder each row-major frame into two top/bottom 8x16 columns.
        for (let tile = 0; tile < source.length; tile += 16) {
            const columnTile = (tile & ~63) + [0, 2, 1, 3][(tile >> 4) & 3] * 16;
            for (let row = 0; row < 8; row++) {
                const low = source[tile + row], high = source[tile + 8 + row];
                const y = (tile & 32 ? 8 : 0) + row;
                const inset = Math.max(0, 3 - Math.min(y, 15 - y));
                const mask = tile & 16 ? (0xFF << inset) : (0xFF >> inset);
                patterns[columnTile + row] = (high | ~low) & mask;
                patterns[columnTile + 8 + row] = (low | ~high) & mask;
            }
        }
        // Two contracted versions of the original ring, for the neutral
        // changeover. Sample whole pixels to keep the ring and fill opaque.
        for (const [frame, size] of [[4, 10], [5, 6]]) {
            const inset = (16 - size) / 2;
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                const sx = Math.floor((x + 0.5) * 16 / size), sy = Math.floor((y + 0.5) * 16 / size);
                const src = ((sx >> 3) * 2 + (sy >> 3)) * 16 + (sy & 7);
                const dx = x + inset, dy = y + inset;
                const dst = frame * 64 + ((dx >> 3) * 2 + (dy >> 3)) * 16 + (dy & 7);
                for (const plane of [0, 8]) if (patterns[src + plane] & (0x80 >> (sx & 7)))
                    patterns[dst + plane] |= 0x80 >> (dx & 7);
            }
        }
        return patterns;
    }

    static getPortalPatterns(schemes) {
        const base = SpritePatterns.getPortalBasePatterns();
        const patterns = new Uint8Array(GraphicsCatalog.SCENE_GRAPHICS_LAYOUT.portalTileCount * 16);
        patterns.set(base, (GraphicsCatalog.SCENE_GRAPHICS_LAYOUT.portalEntryStart - GraphicsCatalog.SCENE_GRAPHICS_LAYOUT.portalStart) * 16);
        const digits = [[2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1]];
        for (let group = 0; group < 4; group++) for (let frame = 0; frame < 6; frame++) {
            const left = SpritePatterns.getPortalFrameTiles(group, frame)[0] - GraphicsCatalog.SCENE_GRAPHICS_LAYOUT.portalStart;
            patterns.set(base.subarray(frame * 64, frame * 64 + 32), left * 16);
            // Both the 3x5 glyph and its 1px margin are opaque, even on a
            // stone. The badge stays the same size during the contracted poses.
            const {badgeInk, badgePaper} = schemes[group];
            for (let y = 0; y < 7; y++) {
                const glyph = y >= 1 && y <= 5 ? digits[group][y - 1] << 4 : 0;
                for (let plane = 0; plane < 2; plane++) {
                    const at = left * 16 + y + plane * 8;
                    const ink = badgeInk & (1 << plane) ? glyph : 0;
                    const paper = badgePaper & (1 << plane) ? 0xF8 ^ glyph : 0;
                    patterns[at] = (patterns[at] & 7) | ink | paper;
                }
            }
        }
        // Copy each group's badge onto the upper-left rim; the interior
        // remains ink zero in both the background and the 8x16 overlay.
        const start = GraphicsCatalog.SCENE_GRAPHICS_LAYOUT.portalStart;
        for (let group = 0; group < 4; group++) {
            const tiles = SpritePatterns.getPortalFrameTiles(group, 6);
            const badge = (SpritePatterns.getPortalFrameTiles(group, 0)[0] - start) * 16;
            for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
                const side = Math.min(x, 15 - x), end = Math.min(y, 15 - y);
                const bit = 0x80 >> (x & 7);
                const pos = (tiles[(y >> 3) * 2 + (x >> 3)] - start) * 16 + (y & 7);
                if (x < 5 && y < 7) {
                    patterns[pos] |= patterns[badge + y] & bit;
                    patterns[pos + 8] |= patterns[badge + y + 8] & bit;
                } else if (side + end === 3 || (side + end > 3 && (side === 0 || end === 0))) {
                    patterns[pos] |= bit;
                }
            }
        }
        return patterns;
    }

    /** Assemble only native tiles, before flight preparation reuses them.
     * Stand: lower-left $AD on both sides (mirrored on the right).
     * Walk: $AD/$AF, then mirrored $AF/$AD; the upper body stays still.
     * Native art faces right. Mirror the assembled poses into the engine's
     * default left-facing orientation, shared by the editor and runtime.
     */
    static getPenguinFrames(romData) {
        const source = romData.subarray(0xAAD0, 0xAB10);
        const mirror = byte => {
            let result = 0;
            for (let bit = 0; bit < 8; bit++) result = (result << 1) | ((byte >> bit) & 1);
            return result;
        };
        // Two column-major 8x16 pairs: top-left, bottom-left, top-right, bottom-right.
        const poses = [
            [[0, false], [1, false], [2, false], [1, true]],
            [[0, false], [1, false], [2, false], [3, false]],
            [[0, false], [3, true], [2, false], [1, true]]
        ];
        const result = new Uint8Array(192);
        poses.forEach((tiles, frame) => tiles.forEach(([tile, flipped], columnTile) => {
            for (let byte = 0; byte < 16; byte++) {
                const value = source[tile * 16 + byte];
                result[frame * 64 + (columnTile ^ 2) * 16 + byte] = flipped ? value : mirror(value);
            }
        }));
        return result;
    }

    static getFlightSpriteFrames(romData, isFish = false) {
        const start = 0xA010 + (isFish ? 0xB0 : 0xB8) * 16;
        return romData.slice(start, start + 128);
    }

    static prepareFlightGraphics(romData) {
        const bird = this.getFlightSpriteFrames(romData);
        const fish = this.getFlightSpriteFrames(romData, true);
        romData.set(romData.subarray(0xAA70, 0xAE10), 0xCA70);
        romData.set(bird, 0xAAB0);
        romData.set(bird, 0xCAB0);
        return {bird, fish};
    }
}
