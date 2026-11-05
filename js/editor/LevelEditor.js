/**
 * Moai-kun Level Map Editor
 */
class LevelEditor {
    constructor(canvasId, showMessage) {
        this.showMessage = showMessage;
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        // Map data (16x14)
        this.mapData = Array(EditorGrid.GRID_HEIGHT).fill(null).map(() => Array(EditorGrid.GRID_WIDTH).fill(0));
        this.optimizedMapData = Array(EditorGrid.GRID_HEIGHT).fill(null).map(() => Array(EditorGrid.GRID_WIDTH).fill(0));

        // Special object positions
        this.playerPos = null;  // {x, y}
        this.doorPos = null;    // {x, y}, ROM-compatible top-left corner

        // Enemy list [{id, x, y}, ...]
        this.enemies = [];

        // Is wide screen
        this.isWideScreen = false;
        this.isBuggyScreen  = false;

        // Current background ID (using private variable with getter/setter for two-way binding)
        this.currentBgId = -1;

        // Current selected tool
        this.currentTool = null;
        this.currentTileId = null;
        this.currentEnemyId = null;

        // Mouse position
        this.mouseGridPos = null;

        // Mouse button state (for drag painting)
        this.isMouseDown = false;
        this.isLeftButtonDown = false;  // Left button state
        this.isRightButtonDown = false; // Right button state

        // Button resources
        this.tileBtns = [];
        this.enemyBtns = [];
        this.playerBtn = null;
        this.doorBtn = null;
        this.eraserBtn = null;

        // Image resources
        this.images = new Map();

        this.setupEventListeners();
        this.setupToolbarTabs();
        this.setupToolbarDrag();

        this.testMode = false;
        this.modified = false;
    }

    get currentBgId(){
        return this._currentBgId;
    }

    set currentBgId(value){
        this._currentBgId = value;
        const bgSelect = document.getElementById('bgSelect');
        bgSelect.value = value
        SceneTileRules.optimizedMap(
            this._currentBgId,
            this.mapData,
            this.optimizedMapData,
            this.isWideScreen
        );
    }

    /**
     * isWideScreen getter
     */
    get isWideScreen() {
        return this._isWideScreen;
    }

    /**
     * isWideScreen setter (auto-sync checkbox)
     */
    set isWideScreen(value) {
        this._isWideScreen = value;
        // Sync update checkbox state
        const wideScreenCheckbox = document.getElementById('wideScreenCheckbox');
        if (wideScreenCheckbox && wideScreenCheckbox.checked !== value) {
            wideScreenCheckbox.checked = value;
        }
    }

    /**
     * Load level from data object
     * @param {Object} data - {background, map, player, door, enemies}
     * @param {number} levelIndex - Level index (optional)
     */
    loadFromData(data, levelIndex = null) {
        try {
            // Set background ID
            if (data.background !== undefined) {
                this.isWideScreen = data.isWideScreen;
                this.isBuggyScreen  = data.isBuggyScreen ;
                this.currentBgId = data.background;
            }

            // Set map data (16x14)
            if (data.map && data.map.length === EditorGrid.GRID_HEIGHT) {
                // ROM data already contains optimized tile IDs. Preserve that
                // exact display, while rebuilding an editable source map so a
                // later edit can optimize without eroding Tile 3 columns.
                this.optimizedMapData = data.map.map(row => [...row]);
                this.mapData = SceneTileRules.createEditableMap(
                    this.currentBgId,
                    this.optimizedMapData
                );
            }

            // Set player position
            if (data.player) {
                this.playerPos = { x: data.player.x, y: data.player.y };
            } else {
                this.playerPos = null;
            }

            // Set door position
            if (data.door) {
                this.doorPos = { x: data.door.x, y: data.door.y };
            } else {
                this.doorPos = null;
            }

            // Set enemy list
            if (data.enemies && Array.isArray(data.enemies)) {
                //this.enemies = data.enemies.map(e => (new Enemy(e.id, e.x, e.y)));
                this.enemies = [];
                for(const e of data.enemies){
                    this.enemies.push(new Enemy(e.id, e.x  + Enemy.getScreenIndex(e.id) * (EditorGrid.GRID_WIDTH / 2), e.y));
                }
            } else {
                this.enemies = [];
            }

            this.updateButtonImages();
            // Update display
            this.render();

            // Show message
            if (levelIndex !== null) {
                console.log(`Loaded level ${levelIndex + 1} data`);
            }

        } catch (error) {
            console.error('Failed to load data:', error);
        }
        // Loading a level is not an edit. App keeps an additional content
        // snapshot so navigation does not rely on this flag alone.
        this.modified = false;
        this.resetImages();
    }

    resetImages(){
        for(let key in GraphicsCatalog.RESOURCE_IMG_CONFIG){
            this.images.set(key,  ResourceManager.getInstance().getResource(this.currentBgId, key));
        }
        for (let group = 1; group <= 4; group++) for (const suffix of ['', '_covered']) {
            const key = `enemy_13_pair_${group}${suffix}`;
            this.images.set(key, ResourceManager.getInstance().getResource(this.currentBgId, key));
        }

        this.images.set(GraphicsCatalog.BG, ResourceManager.getInstance().getResource(this.currentBgId, GraphicsCatalog.BG));

        requestAnimationFrame(() => {
            this.render();
        });
    }

    /**
     * Change scene background
     * @param {string} bgId - Background ID (e.g. '03')
     */
    changeBgId(bgId) {
        console.log('Switching scene to:', bgId);
        this.currentBgId = bgId;  // Use setter, auto-syncs dropdown
        this.resetImages();
        this.updateButtonImages();
        this.saveStatusEnabled();
    }

    updateButtonImages() { return EditorToolbar.updateButtonImages(this); }
    updateButtonImage(btn, imgName) { return EditorToolbar.updateButtonImage(this, btn, imgName); }
    createButton(type, container, alt, id = null) { return EditorToolbar.createButton(this, type, container, alt, id); }
    createButtons() { return EditorToolbar.createButtons(this); }
    createSpecialTileButtons() { return EditorToolbar.createSpecialTileButtons(this); }
    createTileButtons() { return EditorToolbar.createTileButtons(this); }
    createEnemyButtons() { return EditorToolbar.createEnemyButtons(this); }
    setupToolbarTabs() { return EditorToolbar.setupToolbarTabs(this); }
    setupToolbarDrag() { return EditorToolbar.setupToolbarDrag(this); }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Canvas mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        this.canvas.addEventListener('mouseleave', () => this.handleMouseLeave());

        // Right click to clear
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.handleRightClick(e);
            return false;
        });

        // Canvas container scroll event listener (for mobile edge hints)
        const canvasContainer = this.canvas.parentElement;
        if (canvasContainer) {
            this.setupScrollEdgeDetection(canvasContainer);
            // Initialize by scrolling canvas to center position
            this.centerCanvas(canvasContainer);
        }

        // Scene select dropdown (commented out, using input version)
        document.getElementById('bgSelect').addEventListener('change', (e) => this.changeBgId(e.target.value));

        // Wide scene checkbox
        const wideScreenCheckbox = document.getElementById('wideScreenCheckbox');
        if (wideScreenCheckbox) {
            wideScreenCheckbox.addEventListener('change', (e) => {
                this.isWideScreen = e.target.checked;
                SceneTileRules.optimizedMap(
                    this.currentBgId,
                    this.mapData,
                    this.optimizedMapData,
                    this.isWideScreen
                );
                this.saveStatusEnabled();
                this.render();
                // Re-center canvas after switching wide screen mode
                const canvasContainer = this.canvas.parentElement;
                if (canvasContainer) {
                    setTimeout(() => this.centerCanvas(canvasContainer), 100);
                }
                console.log('Wide scene mode:', this.isWideScreen);
            });
        }

        const shiftMapLeftBtn = document.getElementById('shiftMapLeftBtn');
        if (shiftMapLeftBtn) {
            shiftMapLeftBtn.addEventListener('click', () => this.shiftLevelHorizontally(-1));
        }

        const shiftMapRightBtn = document.getElementById('shiftMapRightBtn');
        if (shiftMapRightBtn) {
            shiftMapRightBtn.addEventListener('click', () => this.shiftLevelHorizontally(1));
        }

    }

    /**
     * Setup scroll edge detection (mobile optimization)
     */
    setupScrollEdgeDetection(container) {
        const updateEdgeClasses = () => {
            const scrollLeft = container.scrollLeft;
            const scrollWidth = container.scrollWidth;
            const clientWidth = container.clientWidth;

            // Detect if at left edge (allow 5px tolerance)
            if (scrollLeft <= 5) {
                container.classList.add('at-left-edge');
            } else {
                container.classList.remove('at-left-edge');
            }

            // Detect if at right edge (allow 5px tolerance)
            if (scrollLeft + clientWidth >= scrollWidth - 5) {
                container.classList.add('at-right-edge');
            } else {
                container.classList.remove('at-right-edge');
            }
        };

        // Initial detection
        updateEdgeClasses();

        // Update on scroll
        container.addEventListener('scroll', updateEdgeClasses);

        // Update on window resize
        window.addEventListener('resize', updateEdgeClasses);
    }

    /**
     * Scroll canvas to center position (mobile initialization)
     */
    centerCanvas(container) {
        // Use requestAnimationFrame to ensure DOM has rendered
        requestAnimationFrame(() => {
            const scrollWidth = container.scrollWidth;
            const clientWidth = container.clientWidth;

            // If content width > container width, center display
            if (scrollWidth > clientWidth) {
                const centerPosition = (scrollWidth - clientWidth) / 2;
                container.scrollLeft = centerPosition;
            }
        });
    }

    /**
     * Select tool
     */
    selectTool(type, id = null) {
        this.currentTool = type;
        this.currentTileId = type === 'tile' ? id : null;
        this.currentEnemyId = type === 'enemy' ? id : null;

        // Update UI
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));

        if (type === 'tile') {
            const btn = document.getElementById(`tile_${id}`);
            if (btn) btn.classList.add('active');
            document.getElementById('currentTool').textContent = `Tile ${id}`;
        } else if (type === 'enemy') {
            const btn = document.getElementById(`enemy_${id}`);
            if (btn) btn.classList.add('active');
            document.getElementById('currentTool').textContent = `Sprite ${id}`;
        } else if (type === 'player') {
            document.getElementById('playerBtn').classList.add('active');
            document.getElementById('currentTool').textContent = 'Player';
        } else if (type === 'door') {
            document.getElementById('doorBtn').classList.add('active');
            document.getElementById('currentTool').textContent = 'Door';
        } else if (type === 'eraser') {
            document.getElementById('eraserBtn').classList.add('active');
            document.getElementById('currentTool').textContent = 'Eraser';
        }

        this.render();
    }

    /**
     * Mouse down handler
     */
    handleMouseDown(e) {
        this.isMouseDown = true;
        if (e.button === 0) {
            this.isLeftButtonDown = true;
        } else if (e.button === 2) {
            this.isRightButtonDown = true;
        }
    }

    /**
     * Mouse up handler
     */
    handleMouseUp(e) {
        this.isMouseDown = false;
        if (e.button === 0) {
            this.isLeftButtonDown = false;
        } else if (e.button === 2) {
            this.isRightButtonDown = false;
        }
    }

    /**
     * Mouse move handler
     */
    handleMouseMove(e) {
        if(this.testMode){
            return;
        }

        let wideScreenOffset = 0;
        if(!this.isWideScreen){
            wideScreenOffset = this.canvas.width / 4;
        }

        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left - wideScreenOffset) / EditorGrid.TILE_SIZE);
        const y = Math.floor((e.clientY - rect.top) / EditorGrid.TILE_SIZE);

        if (x >= 0 && x < EditorGrid.GRID_WIDTH && y >= 0 && y < EditorGrid.GRID_HEIGHT) {
            this.mouseGridPos = { x, y };

            if (this.currentTool && this.isProhibitedArea(x, y)) {
                document.getElementById('mousePos').textContent = `(${x}, ${y}) - Placement prohibited`;
            } else {
                document.getElementById('mousePos').textContent = `(${x}, ${y})`;
            }
        } else {
            this.mouseGridPos = null;
            document.getElementById('mousePos').textContent = '-';
        }

        // Perform different operations based on button pressed
        if (this.mouseGridPos) {
            if (this.isLeftButtonDown && this.currentTool) {
                // Left click: continuous drawing
                this.performDraw(this.mouseGridPos.x, this.mouseGridPos.y, true);
            } else if (this.isRightButtonDown) {
                // Right click: continuous erasing
                this.performErase(this.mouseGridPos.x, this.mouseGridPos.y);
            }
        }

        this.render();
    }

    /**
     * Mouse leave handler
     */
    handleMouseLeave() {
        this.mouseGridPos = null;
        this.isMouseDown = false;
        this.isLeftButtonDown = false;
        this.isRightButtonDown = false;
        document.getElementById('mousePos').textContent = '-';
        this.render();
    }

    /**
     * Click handler
     */
    handleClick(e) {
        if(this.testMode){
            return;
        }
        if (!this.mouseGridPos || !this.currentTool) return;

        const { x, y } = this.mouseGridPos;
        this.performDraw(x, y, false);
    }

    /**
     * Right click clear handler
     */
    handleRightClick(e) {
        if(this.testMode){
            return;
        }
        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left - (this.isWideScreen ? 0 : this.canvas.width / 4)) / EditorGrid.TILE_SIZE);
        const y = Math.floor((e.clientY - rect.top) / EditorGrid.TILE_SIZE);

        if (x >= 0 && x < EditorGrid.GRID_WIDTH && y >= 0 && y < EditorGrid.GRID_HEIGHT) {
            this.performErase(x, y);
        }
    }

    // Prohibited placement area
    isProhibitedArea(x, y, isDragging = true) {

        // A selected enemy tool can outlive a scene change.
        if (this.currentTool === 'enemy' && this.currentEnemyId !== null) {
            const enemyConfig = GraphicsCatalog.RESOURCE_IMG_CONFIG[
                GraphicsCatalog.ENEMY_PREFIX + Enemy.getRealId(this.currentEnemyId)
            ];
            if (enemyConfig?.disabledLevelType.includes(Number(this.currentBgId))) {
                return true;
            }
        }

        let isProhibitedArea = false;
        let warningMessage = '';
        // if(y === 0 && this.currentTool.includes('tile')){
        //     warningMessage = i18n.t('prohibitedTileAreaWarning');
        //     isProhibitedArea = true;
        // }

        if(this.currentTool === 'player' && (x >= EditorGrid.GRID_WIDTH / 2)){
            warningMessage = i18n.t('prohibitedPlayerAreaWarning');
            isProhibitedArea = true;
        }

        // The cursor anchors the bottom-left cell of the 2x2 door.
        const doorWidth = this.isWideScreen ? EditorGrid.GRID_WIDTH : EditorGrid.GRID_WIDTH / 2;
        const nearExit = (px, py, door) => {
            if (!door) return false;
            const dx = (px - door.x + doorWidth + 1) % doorWidth;
            return dx < 4 && py >= door.y - 1 && py <= door.y + 2;
        };
        if ((this.currentTool === 'enemy' && Enemy.getRealId(this.currentEnemyId) === 13 && nearExit(x, y, this.doorPos))
            || (this.currentTool === 'door' && this.enemies?.some(enemy =>
                enemy.getRealId() === 13 && nearExit(enemy.x, enemy.y, {x, y: y - 1})))) {
            warningMessage = i18n.t('portalExitClearance');
            isProhibitedArea = true;
        }
        if(this.currentTool === 'door' &&
            (x < 0 || x + 1 >= doorWidth || y < 1 || y >= EditorGrid.GRID_HEIGHT)){
            warningMessage = i18n.t('prohibitedDoorAreaWarning');
            isProhibitedArea = true;
        }

        if(this.currentTileId === 0xF && !this.canPlaceConsecutiveMoai(x, y)){
            warningMessage = i18n.t('forbiddenPlaceConsecutiveMoaiWarning');
            isProhibitedArea = true;
        }

        if(isProhibitedArea && !isDragging ){
            this.showMessage('warning', warningMessage);
        }
        return isProhibitedArea;
    }

    /**
     * Perform draw operation (for click and drag)
     */
    performDraw(x, y, isDragging = false) {
        //if (!this.currentTool) return;

        // First row (y=0) prohibits tile placement, player cannot be placed on second screen
        if (this.isProhibitedArea(x, y, isDragging)) {
            return;
        }

        if (this.currentTool === 'tile' && this.currentTileId) {
            // Place tile
            if(this.currentTileId === 0xF && !this.canPlaceConsecutiveMoai(x, y)){
                //this.showMessage('warning', i18n.t("forbiddenPlaceConsecutiveMoaiWarning"));
                return;
            }
            this.mapData[y][x] = this.currentTileId;
        } else if (this.currentTool === 'enemy' && this.currentEnemyId) {
            // Place enemy (check if already exists)
            const existingIndex = this.enemies.findIndex(e => e.x === x && e.y === y);
            const realId = Enemy.getRealId(this.currentEnemyId);
            if (existingIndex >= 0) {
                // If not self, replace existing enemy; if self, reverse facing

                if(this.enemies[existingIndex].getRealId() === realId &&  !isDragging){
                    this.enemies[existingIndex].reverseFacing();
                    //
                    this.currentEnemyId = this.enemies[existingIndex].enemyId;
                }else{
                    //
                    let screenEnemyId = x >= EditorGrid.GRID_WIDTH / 2 ? (this.currentEnemyId | 0x80) : (this.currentEnemyId & 0x7F);
                    this.enemies[existingIndex] = new Enemy(screenEnemyId, x, y);
                }
            } else {
                if (this.enemies.length >= RomLayout.MAX_ENEMIES_PER_LEVEL) {
                    this.showMessage('warning', i18n.t("forbiddenPlaceEnemyWarning"));
                    return;
                }
                // Add new enemy
                const screenEnemyId = x >= EditorGrid.GRID_WIDTH / 2 ? (this.currentEnemyId | 0x80) : (this.currentEnemyId & 0x7F);
                this.enemies.push(new Enemy(screenEnemyId, x, y));
            }

            //bug info
            if(x > EditorGrid.GRID_WIDTH / 2 && realId  === 9){
                this.showMessage('info', i18n.t("buggyEnemy9PlaceInfo"));
            }
        } else if (this.currentTool === 'player') {
            // Place player
            this.playerPos = { x, y };
        } else if (this.currentTool === 'door') {
            // Keep saved coordinates at the top-left; place upward from the cursor.
            this.doorPos = { x, y: y - 1 };
        } else if (this.currentTool === 'eraser') {
            // Execute erase operation
            this.performErase(x, y);
            //return; // Return early to avoid duplicate rendering
        }
        this.performEnd();
    }

    /**
     * Perform erase operation (right click)
     */
    performErase(x, y) {
        // Clear current cell
        this.mapData[y][x] = 0;

        // Clear player
        if (this.playerPos && this.playerPos.x === x && this.playerPos.y === y) {
            this.playerPos = null;
        }

        // Clear door (2x2)
        if (this.doorPos) {
            if (x >= this.doorPos.x && x < this.doorPos.x + 2 &&
                y >= this.doorPos.y && y < this.doorPos.y + 2) {
                this.doorPos = null;
            }
        }

        // Clear enemy
        this.enemies = this.enemies.filter(e => {
            if (e.x === x && e.y === y) return false;

            // Check if clicked on top half of tall enemy
            const enemyName = GraphicsCatalog.ENEMY_PREFIX + `${e.getRealId()}`;
            const sizeConfig = GraphicsCatalog.RESOURCE_IMG_CONFIG[enemyName];
            if (sizeConfig && sizeConfig.imgBlockIndex.length / 2 > 1) {
                const topY = e.y - sizeConfig.imgBlockIndex.length / 2 + 1;
                // If click position is within enemy range (including top half)
                if (e.x === x && y >= topY && y <= e.y) {
                    return false; // Delete this enemy
                }
            }

            return true;
        });
        //this.modified = true;
        this.performEnd();
    }

    performEnd(){
        // Optimize tile display
        SceneTileRules.optimizedMap(
            this.currentBgId,
            this.mapData,
            this.optimizedMapData,
            this.isWideScreen
        );

        this.saveStatusEnabled();
        // Immediately render update
        this.render();

        this.updateDataDisplays();
    }

    /**
     * Circularly shift every horizontal level element.
     *
     * Wide levels wrap over 32 columns and single-screen levels over 16.
     * In a single-screen level the player wraps with the map. In a wide level
     * the player follows the map only while remaining inside the first screen
     * (columns 0-15); the map keeps moving when the player reaches an edge.
     *
     * @param {number} delta - -1 shifts left; +1 shifts right.
     */
    shiftLevelHorizontally(delta) {
        if (this.testMode || (delta !== -1 && delta !== 1)) {
            return;
        }

        const width = this.isWideScreen
            ? EditorGrid.GRID_WIDTH
            : EditorGrid.GRID_WIDTH / 2;
        const wrapX = (x) => ((x % width) + width) % width;

        this.mapData = this.mapData.map((sourceRow) => {
            const row = Array.isArray(sourceRow) ? sourceRow : [];
            const shiftedRow = row.slice();

            while (shiftedRow.length < width) {
                shiftedRow.push(0);
            }

            for (let sourceX = 0; sourceX < width; sourceX++) {
                shiftedRow[wrapX(sourceX + delta)] = row[sourceX] ?? 0;
            }

            return shiftedRow;
        });

        for (const enemy of this.enemies) {
            enemy.x = wrapX(enemy.x + delta);
            enemy.enemyId = enemy.x >= EditorGrid.GRID_WIDTH / 2
                ? (enemy.enemyId | 0x80)
                : (enemy.enemyId & 0x7F);
        }

        if (this.doorPos) {
            this.doorPos.x = wrapX(this.doorPos.x + delta);
        }

        if (this.playerPos) {
            const nextPlayerX = this.playerPos.x + delta;
            if (this.isWideScreen) {
                const firstScreenWidth = EditorGrid.GRID_WIDTH / 2;
                if (nextPlayerX >= 0 && nextPlayerX < firstScreenWidth) {
                    this.playerPos.x = nextPlayerX;
                }
            } else {
                this.playerPos.x = wrapX(nextPlayerX);
            }
        }

        this.performEnd();
    }

    saveStatusEnabled(){
        this.modified = true;
        document.getElementById('saveBtn').disabled = false;
    }

    render() { return LevelCanvas.render(this); }
    drawGrid() { return LevelCanvas.drawGrid(this); }
    drawPreview() { return LevelCanvas.drawPreview(this); }

    getData() {
        // Ensure no 15 consecutive 0xF data
        if(!checkConsecutiveMoai(this.optimizedMapData, this.isWideScreen)){
            this.showMessage('error', i18n.t("consecutiveMoaiError"));
            return;
        }

        // Get editor data
        let bgId = parseInt(this.currentBgId) +  (this.isWideScreen ? 16 : 0);

        const editorData = {
            background: bgId,
            map: this.optimizedMapData,
            player: this.playerPos,
            door: this.doorPos,
            enemies: this.enemies
        };

        return editorData;
    }

    updateDataDisplays(){
        const levelEditorData = this.getData();
        if(!levelEditorData){
            return;
        }
        const levelRomData = LevelCodec.fromLevelEditorToROMData(levelEditorData, this.isWideScreen);
        const showMapDataStr = levelRomData.mapData.map(b =>
            b.toString(16).toUpperCase().padStart(2, '0')
        ).join(' ')

        const showMonsterDataStr = levelRomData.monsterData.map(b =>
            b.toString(16).toUpperCase().padStart(2, '0')
        ).join(' ')

         document.getElementById('hexData').value = showMapDataStr;
         document.getElementById('monsterData').value = showMonsterDataStr;
    }

    canPlaceConsecutiveMoai(x, y){
        let rows = EditorGrid.GRID_HEIGHT;
        let cols = this.isWideScreen ? EditorGrid.GRID_WIDTH : EditorGrid.GRID_WIDTH / 2;

        let consecutiveCountLeft = 0;
        // Left side
        let flag = true;
        let notMoai = false;
        for (let i = y; i >= 0 ; i--) {
            let colsNum = cols - 1;
            if(flag){
                colsNum = x;
            }
            for (let j = colsNum; j >= 0 ; j--) {
                if(flag){
                    flag = false;
                    continue;
                }
                const tileId = this.mapData[i][j];
                if(tileId === 0xF) {
                    if (consecutiveCountLeft >= 0xF) {
                        return false;
                    }
                    consecutiveCountLeft++;
                }else{
                    notMoai = true;
                    break;
                }
            }
            if(notMoai){
                break;
            }
        }

        // Right side
        let consecutiveCountRight = 0;
        // First is current element, doesn't count
        flag = true;
        notMoai = false;
        for (let i = y; i < rows ; i++) {
            let colsNum = 0;
            if(flag){
                colsNum = x;
            }
            for (let j = colsNum; j < cols ; j++) {
                if(flag){
                    flag = false;
                    continue;
                }
                const tileId = this.mapData[i][j];
                if(tileId === 0xF) {
                    if (consecutiveCountLeft + consecutiveCountRight >= 0xF) {
                        return false;
                    }
                    consecutiveCountRight++;
                }else{
                    notMoai = true;
                    break;
                }
            }
            if(notMoai){
                break;
            }
        }

        if(consecutiveCountLeft + consecutiveCountRight + 1 >= 0xF){
            return false;
        }

        return true;
    }
}
