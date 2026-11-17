class GameSettings {
    // One 8px glyph per tile on the 256px ending screen, with a 16px
    // horizontal margin on either side to keep names clear of overscan.
    static CREDIT_SCREEN_WIDTH = 256;
    static CREDIT_GLYPH_WIDTH = 8;
    static CREDIT_HORIZONTAL_MARGIN = 16;
    static CUSTOM_LEVEL_AUTHOR_MAX_LENGTH = Math.floor(
        (GameSettings.CREDIT_SCREEN_WIDTH - 2 * GameSettings.CREDIT_HORIZONTAL_MARGIN) /
        GameSettings.CREDIT_GLYPH_WIDTH
    );

    static normalizeCustomLevelAuthor(value) {
        return typeof value === 'string'
            ? value.replace(/[^A-Za-z ]/g, '').slice(0, GameSettings.CUSTOM_LEVEL_AUTHOR_MAX_LENGTH)
            : '';
    }

    static normalize(config) {
        return {
            disableTimer: Boolean(config.disableTimer),
            showRemainingRescueCount: Boolean(config.showRemainingRescueCount),
            cameraFollow: Boolean(config.cameraFollow),
            customLevelAuthor: GameSettings.normalizeCustomLevelAuthor(config.customLevelAuthor)
        };
    }
}
