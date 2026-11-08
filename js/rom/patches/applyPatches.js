// Build once on a fresh expanded image. Hooks that chain another feature
// receive its installed entry point explicitly.
function applyPatches(romData, gameConfig) {
    RemoteBomb.syncPickupPalette(romData);
    Hud.syncRescuePalette(romData);
    const penguin = Penguin.ENABLED ? SpritePatterns.getPenguinFrames(romData) : null;
    const frames = SpritePatterns.prepareFlightGraphics(romData);
    if (penguin) frames.penguin = penguin;
    Terrain.fixTile7SupportFall(romData);
    Terrain.enableTile13SupportFall(romData);
    Terrain.enableTile13Crush(romData);
    // Comment out this call to disable the extra wall-clip deaths, then rebuild the ROM.
    Terrain.enableSolidTileCrush(romData);
    // Comment out this call to restore Tile 9's original break-time position snap.
    Terrain.fixTile9BreakAlignment(romData);
    SceneRuntime.fixSpecialLevelAnimations(romData);
    SceneRuntime.fixWideScreenEnemy9Background(romData);
    if (gameConfig.cameraFollow) Camera.fixBatHorizontalWrap(romData);
    Terrain.fixWideScreenRockPushBug(romData);
    Camera.fixWideScreenLoopingCamera(romData);
    Hud.configureLevelTimer(romData, !gameConfig.disableTimer);
    const views = gameConfig.cameraFollow ? ViewModes.addViewModes(romData) : null;
    Coordinates.fixExtendedCoordinates(romData);
    const birdRenderer = BirdFish.addBirdFishAuxiliary(romData);
    Portal.addSpritePortalPreview(romData, birdRenderer);
    Pause.addPauseControls(romData, views);
    Credits.configureCustomLevelCredit(romData, gameConfig.customLevelAuthor);
    Credits.addMoaikunMakerLabel(romData);
    RemoteBomb.install(romData);
    Penguin.install(romData);
    Hud.install(romData, gameConfig);
    SceneCompiler.compileSceneGraphics(romData, frames);
    SceneRuntime.installSceneGraphicsLoader(romData);
}
