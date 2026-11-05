// Build once on a fresh expanded image. Hooks that chain another feature
// receive its installed entry point explicitly.
function applyPatches(romData, gameConfig) {
    const frames = SpritePatterns.prepareFlightGraphics(romData);
    Terrain.fixTile7SupportFall(romData);
    Terrain.enableTile13SupportFall(romData);
    Terrain.enableTile13Crush(romData);
    SceneRuntime.fixSpecialLevelAnimations(romData);
    SceneRuntime.fixWideScreenEnemy9Background(romData);
    if (gameConfig.cameraFollow) Camera.fixBatHorizontalWrap(romData);
    Terrain.fixWideScreenRockPushBug(romData);
    Camera.fixWideScreenLoopingCamera(romData);
    Hud.configureLevelTimer(romData, !gameConfig.disableTimer);
    if (gameConfig.showRemainingRescueCount !== false) {
        Hud.addRemainingRescueCountHud(romData, gameConfig.disableTimer);
    }
    const views = gameConfig.cameraFollow ? ViewModes.addViewModes(romData) : null;
    Coordinates.fixExtendedCoordinates(romData);
    const birdRenderer = BirdFish.addBirdFishAuxiliary(romData);
    Portal.addSpritePortalPreview(romData, birdRenderer);
    Pause.addPauseControls(romData, views);
    Credits.configureCustomLevelCredit(romData, gameConfig.customLevelAuthor);
    Credits.addMoaikunMakerLabel(romData);
    SceneCompiler.compileSceneGraphics(romData, frames);
    SceneRuntime.installSceneGraphicsLoader(romData);
}
