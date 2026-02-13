/**
 * Moai-kun Level Map Editor
 */
class LevelEditor {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        
        // Map data (16x14)
        this.mapData = Array(Config.GRID_HEIGHT).fill(null).map(() => Array(Config.GRID_WIDTH).fill(0));
        this.optimizedMapData = Array(Config.GRID_HEIGHT).fill(null).map(() => Array(Config.GRID_WIDTH).fill(0));
        
        // Special object positions
        this.playerPos = null;  // {x, y}
        this.doorPos = null;    // {x, y}
        
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
        OptimizedMap.optimizedMap(this._currentBgId, this.mapData, this.optimizedMapData);
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
            if (data.map && data.map.length === Config.GRID_HEIGHT) {
                this.mapData = data.map.map(row => [...row]);
                OptimizedMap.optimizedMap(this.currentBgId, this.mapData, this.optimizedMapData);
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
                    this.enemies.push(new Enemy(e.id, e.x  + Enemy.getScreenIndex(e.id) * (Config.GRID_WIDTH / 2), e.y));
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
        this.resetImages();
    }

    resetImages(){
        for(let key in Config.RESOURCE_IMG_CONFIG){
            this.images.set(key,  ResourceManager.getInstance().getResource(this.currentBgId, key));
        }

        this.images.set(Config.BG, ResourceManager.getInstance().getResource(this.currentBgId, Config.BG));

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
    
    /**
     * Create tile selection buttons
     */
    updateButtonImages() {
        // Update tile buttons
        for (let i = 0; i < this.tileBtns.length; i++) {
            const btn = this.tileBtns[i];
            const imgName = btn.dataset.imgName;
            this.updateButtonImage(btn, imgName);
        }

        for(let i = 0; i < this.enemyBtns.length; i++){
            const btn = this.enemyBtns[i];
            const imgName = btn.dataset.imgName;
            this.updateButtonImage(btn, imgName);
        }


        this.updateButtonImage(this.playerBtn, this.playerBtn.dataset.imgName);
        this.updateButtonImage(this.doorBtn, this.doorBtn.dataset.imgName);
        
        // Re-render canvas
        this.render();
    }

    /**
     * Update all button images (when scene switches)
     */
    updateButtonImage(btn, imgName) {
        const img = btn.querySelector('img');
        const prohibitIcon = btn.querySelector('div');
        const nameId = imgName;
        if (img) { 
            const imgResource = ResourceManager.getInstance().getResource(this.currentBgId, nameId);
            if (imgResource instanceof HTMLImageElement) {
                // If returned is Image object, use its src
                img.src = imgResource.src;
            } else if (typeof imgResource === 'string') {
                // If returned is string URL, use directly
                img.src = imgResource;
            }
            img.style.display = 'block';
            prohibitIcon.style.display = 'none';
        } else if (prohibitIcon) {
            // If previously was prohibition symbol, try reloading image
            const imgResource = ResourceManager.getInstance().getResource(this.currentBgId, nameId);
            if (imgResource instanceof HTMLImageElement) {
                // If returned is Image object, clone it
                const newImg = imgResource.cloneNode(true);
                newImg.alt = `${imgName}`;
                prohibitIcon.replaceWith(newImg);
            } else if (typeof imgResource === 'string') {
                // If returned is string URL
                const newImg = document.createElement('img');
                newImg.src = imgResource;
                newImg.alt = `${imgName}`;
                newImg.onerror = () => {
                    // If load fails, keep prohibition symbol
                };
                newImg.onload = () => {
                    // Load success, replace prohibition symbol
                    prohibitIcon.replaceWith(newImg);
                };
            }
        }

        let isDisabled = Config.RESOURCE_IMG_CONFIG[imgName].disabledLevelType.includes(parseInt(this.currentBgId));
        if(isDisabled){
            btn.disabled = true;
            img.style.display = 'none';
            prohibitIcon.style.display = 'block';
        } else {
            btn.disabled = false;   
            img.style.display = 'block';
            prohibitIcon.style.display = 'none';
        }
    }

    createButton(type, container, alt, id = null){
        const btn = document.createElement('button');
        btn.className = 'tool-btn';
        btn.dataset.type = type;
        
        // Fixed button size
        btn.style.width = '60px';
        btn.style.height = '85px';
        btn.style.minWidth = '60px';
        btn.style.minHeight = '85px';
        
        let imgName = type;
        if(id !== null){
            imgName += `_${id}`;
        }
        btn.dataset.imgName = imgName;
        btn.id = imgName;
        //const imgSrc = ResourceManager.getInstance().getResource(this.currentBgId, imgName);
        const imgSrc = '';

        const img = document.createElement('img');
        
        if(imgSrc !== null){
            img.src = imgSrc;
        }else{
            img.src = '';
        }
        
        img.alt = alt;
        // Don't compress image, use original size
        // Determine size by id
        let colNum = Config.RESOURCE_IMG_CONFIG[imgName]?.imgBlockIndex[0].length;
        let rowNum = Config.RESOURCE_IMG_CONFIG[imgName]?.imgBlockIndex.length;

        //let widht = 16 * colNum;
        let widht = 32;
        let height = (32 / colNum) * rowNum;
        //let height = 16 * rowNum;

        img.style.width = widht + 'px';
        img.style.height = height +'px';
        // img.style.maxWidth = '32px';
        // img.style.maxHeight = '32px';
        //img.style.objectFit = 'none';
        img.style.objectPosition = 'top left';

        img.onerror = () => {
            // Create prohibition symbol container
            if(type === 'eraser'){
                return;
            }
            const prohibitIcon = document.createElement('div');
            prohibitIcon.style.cssText = `
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                color: #999;
                margin-bottom: 4px;
            `;
            prohibitIcon.textContent = '🚫';
            
            // Replace img with prohibition symbol
            //img.replaceWith(prohibitIcon);
            img.style.display = 'none';

            btn.appendChild(prohibitIcon);
        };

        const span = document.createElement('span');
        if(type !== 'eraser'){
            span.textContent = `${ Config.RESOURCE_IMG_CONFIG[imgName].name}`;
        }else{
            span.textContent = i18n.t("Eraser") || 'Eraser';
        }
        
        if(type !== 'eraser'){
            btn.appendChild(img);
        }else{
            // Create prohibition symbol container
            const prohibitIcon = document.createElement('div');
            prohibitIcon.style.cssText = `
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                color: #999;
                margin-bottom: 4px;
            `;
            prohibitIcon.textContent = '❌';
            // Replace img with prohibition symbol
            //img.replaceWith(prohibitIcon);
            //img.style.display = 'none';
            btn.appendChild(prohibitIcon);
        }
        //span.textContent = imgName;
        btn.appendChild(span);
        container.appendChild(btn);
        
        //btn.addEventListener('click', () => this.selectTool(type, id));
        btn.addEventListener('click', () => {
            if (!btn.disabled) {
                this.selectTool(type, id);
            }
        });
        return btn;
        //this.tileBtns.push(btn);
    }

    createButtons(){
        // First remove all buttons
        const specialContainer = document.getElementById('specialButtons');
        const tileContainer = document.getElementById('tileButtons');
        const enemyContainer = document.getElementById('enemyButtons');
        
        if (specialContainer) specialContainer.innerHTML = '';
        if (tileContainer) tileContainer.innerHTML = '';
        if (enemyContainer) enemyContainer.innerHTML = '';
        
        // Clear button arrays
        this.tileBtns = [];
        this.enemyBtns = [];
        this.playerBtn = null;
        this.doorBtn = null;
        
        this.createSpecialTileButtons();
        this.createTileButtons();
        this.createEnemyButtons();
    }

    createSpecialTileButtons() {
        const container = document.getElementById('specialButtons');
        this.playerBtn = this.createButton("player", container, "Player");
        this.playerBtn.id = 'playerBtn';
        
        this.doorBtn = this.createButton("door", container, "Door");
        this.doorBtn.id = 'doorBtn';

        this.eraserBtn = this.createButton("eraser", container, "Eraser");
        this.eraserBtn.id = 'eraserBtn';
    }
    
    createTileButtons() {
        const container = document.getElementById('tileButtons');
        // Add tile buttons
        for (let i = 1; i <= 15; i++) {
            const btn = this.createButton("tile", container, `Tile ${i}`, i);
            this.tileBtns.push(btn);
        }
    }
    
    /**
     * Create enemy selection buttons
     */
    createEnemyButtons() {
        const container = document.getElementById('enemyButtons');
        for (let i = 1; i <= 11; i++) {
            const btn = this.createButton("enemy", container, `Enemy ${i}`, i);
            this.enemyBtns.push(btn);
        }
    }
    
    /**
     * Setup toolbar tabs
     */
    setupToolbarTabs() {
        const tabs = document.querySelectorAll('.tool-tab');
        const contents = document.querySelectorAll('.tool-tab-content');
        
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                
                // Remove all active classes
                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));
                
                // Add active class to current tab
                tab.classList.add('active');
                const targetContent = document.getElementById(tabName + 'Tab');
                if (targetContent) {
                    targetContent.classList.add('active');
                }
            });
        });
    }
    
    /**
     * Setup toolbar drag functionality
     */
    setupToolbarDrag() {
        return ;
        const toolbar = document.getElementById('toolbar');
        const header = document.getElementById('toolbarHeader');
        
        if (!toolbar || !header) return;
        
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;
        
        // Get initial position from CSS
        const computedStyle = window.getComputedStyle(toolbar);
        xOffset = parseInt(computedStyle.left) || 20;
        yOffset = parseInt(computedStyle.top) || 100;
        
        header.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);


        
        function dragStart(e) {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;

            if (e.target === header || header.contains(e.target)) {
                isDragging = true;
            }
        }
        
        function drag(e) {
            if (isDragging) {
                e.preventDefault();
                // let wideScreenOffset = 0;
                // if(!this.isWideScreen){
                //     wideScreenOffset = this.canvas.width / 4;
                // }
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                
                xOffset = currentX;
                yOffset = currentY;
                
                setTranslate(currentX, currentY, toolbar);
            }
        }
        
        function dragEnd(e) {
            // if(!this.isWideScreen){
            //     e.clientX += this.canvas.width / 4;
            // }
            initialX = currentX;
            initialY = currentY;
            isDragging = false;
        }
        
        function setTranslate(xPos, yPos, el) {
            el.style.left = xPos + 'px';
            el.style.top = yPos + 'px';
        }
    }
    
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
        
        // Operation buttons
        document.getElementById('clearBtn').addEventListener('click', () => this.clearMap());
        
        // Scene select dropdown (commented out, using input version)
        document.getElementById('bgSelect').addEventListener('change', (e) => this.changeBgId(e.target.value));
        
        // Wide scene checkbox
        const wideScreenCheckbox = document.getElementById('wideScreenCheckbox');
        if (wideScreenCheckbox) {
            wideScreenCheckbox.addEventListener('change', (e) => {
                this.isWideScreen = e.target.checked;
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
        
        // Apply to ROM editor button
        const applyToRomBtn = document.getElementById('applyToRomBtn');
        if (applyToRomBtn) {
            // If opened from ROM editor, show this button
            if (window.opener && window.opener.app) {
                applyToRomBtn.style.display = 'block';
            }
            applyToRomBtn.addEventListener('click', () => this.applyToRomEditor());
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
            document.getElementById('currentTool').textContent = `Enemy ${id}`;
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
        const x = Math.floor((e.clientX - rect.left - wideScreenOffset) / Config.TILE_SIZE);
        const y = Math.floor((e.clientY - rect.top) / Config.TILE_SIZE);
        
        if (x >= 0 && x < Config.GRID_WIDTH && y >= 0 && y < Config.GRID_HEIGHT) {
            this.mouseGridPos = { x, y };
            
            // First row shows prohibition marker
            if (y === 0 && this.currentTool) {
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
        const x = Math.floor((e.clientX - rect.left - (this.isWideScreen ? 0 : this.canvas.width / 4)) / Config.TILE_SIZE);
        const y = Math.floor((e.clientY - rect.top) / Config.TILE_SIZE);
        
        if (x >= 0 && x < Config.GRID_WIDTH && y >= 0 && y < Config.GRID_HEIGHT) {
            this.performErase(x, y);
        }
    }

    // Prohibited placement area
    isProhibitedArea(x, y, isDragging = true) {

        let isProhibitedArea = false;
        let warningMessage = '';
        if(y === 0 && this.currentTool.includes('tile')){
            warningMessage = i18n.t('prohibitedTileAreaWarning');
            isProhibitedArea = true;
        }

        if(this.currentTool === 'player' && (x >= Config.GRID_WIDTH / 2)){
            warningMessage = i18n.t('prohibitedPlayerAreaWarning');
            isProhibitedArea = true;
        }

        if(this.isWideScreen === false && this.currentTool === 'door' && (x === (Config.GRID_WIDTH / 2 -1))){
            warningMessage = i18n.t('prohibitedDoorAreaWarning');
            isProhibitedArea = true;
        }

        if(this.currentTileId === 0xF && !this.canPlaceConsecutiveMoai(x, y)){
            warningMessage = i18n.t('forbiddenPlaceConsecutiveMoaiWarning');
            isProhibitedArea = true;
        }

        if(isProhibitedArea && !isDragging ){
            app.showMessage('warning', warningMessage);
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
                //app.showMessage('warning', i18n.t("forbiddenPlaceConsecutiveMoaiWarning"));
                return;
            }
            this.mapData[y][x] = this.currentTileId;
        } else if (this.currentTool === 'enemy' && this.currentEnemyId) {
            if(this.enemies.length >= Config.MAX_ENEMIES_PER_LEVEL){
                app.showMessage('warning', i18n.t("forbiddenPlaceEnemyWarning"));
                return;
            }
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
                    let screenEnemyId = x > Config.GRID_WIDTH / 2 ? (this.currentEnemyId | 0x80) : (this.currentEnemyId & 0x7F);
                    this.enemies[existingIndex] = new Enemy(screenEnemyId, x, y);
                }
            } else {
                // Add new enemy
                this.enemies.push(new Enemy(this.currentEnemyId, x, y));
            }

            //bug info
            if(x > Config.GRID_WIDTH / 2 && realId  === 9){
                app.showMessage('info', i18n.t("buggyEnemy9PlaceInfo"));
            }
        } else if (this.currentTool === 'player') {
            // Place player
            this.playerPos = { x, y };
        } else if (this.currentTool === 'door') {
            // Place door
            this.doorPos = { x, y };
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
            const enemyName = Config.ENEMY_PREFIX + `${e.getRealId()}`;
            const sizeConfig = Config.RESOURCE_IMG_CONFIG[enemyName];
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
        OptimizedMap.optimizedMap(this.currentBgId, this.mapData, this.optimizedMapData);

        this.saveStatusEnabled();
        // Immediately render update
        this.render();

        this.updateDataDisplays();
    }

    saveStatusEnabled(){
        this.modified = true;
        document.getElementById('saveBtn').disabled = false;
    }
    
    /**
     * Clear map
     */
    clearMap() {
        if (confirm('Are you sure you want to clear the map?')) {
            this.mapData = Array(Config.GRID_HEIGHT).fill(null).map(() => Array(Config.GRID_WIDTH).fill(0));
            OptimizedMap.optimizedMap(this.currentBgId, this.mapData, this.optimizedMapData);
            this.playerPos = null;
            this.doorPos = null;
            this.enemies = [];
            //this.modified = true;
            this.saveStatusEnabled();
            this.render();
        }
    }
    
    /**
     * Render
     */
    render() {
        if(this.testMode){
            return;
        }

        // Clear canvas
        // this.ctx.fillStyle = '#000000';
        // this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if(!this.isWideScreen){
            // Draw in center of canvas
            this.ctx.save();
            this.ctx.translate(this.canvas.width / 4, 0);
        }

        
        // 1. Draw background
        if (this.images.get(Config.BG)) {
            this.ctx.drawImage(this.images.get(Config.BG), 0, 0, this.canvas.width / 2, this.canvas.height);
            if(this.isWideScreen){
                this.ctx.drawImage(this.images.get(Config.BG), this.canvas.width / 2, 0, this.canvas.width / 2, this.canvas.height);
            }
        }
        
        // 2. Draw grid (semi-transparent)
        this.drawGrid();

        // 3. Draw door (2x2 cells, 64x64 pixels)
        if (this.doorPos && this.images.get(Config.DOOR)) {
            this.ctx.drawImage(
                this.images.get(Config.DOOR),
                this.doorPos.x * Config.TILE_SIZE,
                this.doorPos.y * Config.TILE_SIZE,
                Config.TILE_SIZE * 2,
                Config.TILE_SIZE * 2
            );
        }
        
        // 4. Draw map tiles
        for (let y = 0; y < Config.GRID_HEIGHT; y++) {
            for (let x = 0; x < Config.GRID_WIDTH; x++) {
                let tileId = this.optimizedMapData[y][x];
                if(Config.DEBUG_MODE){
                    tileId = this.mapData[y][x];
                }
                const tileName = Config.TILE_PREFIX + `${tileId}`;
                if (tileId > 0 && this.images.get(tileName)) {
                    this.ctx.drawImage(
                        this.images.get(tileName),
                        x * Config.TILE_SIZE,
                        y * Config.TILE_SIZE,
                        Config.TILE_SIZE,
                        Config.TILE_SIZE
                    );
                }
            }
        }
        
        // 5. Draw player
        if (this.playerPos && this.images.get(Config.PLAYER)) {
            this.ctx.drawImage(
                this.images.get(Config.PLAYER),
                this.playerPos.x * Config.TILE_SIZE,
                this.playerPos.y * Config.TILE_SIZE,
                Config.TILE_SIZE,
                Config.TILE_SIZE
            );
        }
        
        // 6. Draw enemies
        for (const enemy of this.enemies) {
            enemy.render(this.ctx, this.images);
        }

        // If not wide scene, draw mask
        // if(!this.isWideScreen){
        //     this.ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
        //     this.ctx.fillRect(this.canvas.width / 2, 0, this.canvas.width / 2, this.canvas.height);
        // }
        
        // 7. Draw preview placement box
        if (this.mouseGridPos && this.currentTool) {
            this.drawPreview();
        }

        // Restore canvas drawing boundary
        if(!this.isWideScreen){
            // Draw in center of canvas
            // Draw boundary
            // Paint black on both sides
            this.ctx.fillStyle = '#000000';
            this.ctx.fillRect(-this.canvas.width / 4, 0, this.canvas.width / 4, this.canvas.height);
            this.ctx.fillRect(this.canvas.width  / 2, 0, this.canvas.width / 4, this.canvas.height);

            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(0 , 0, this.canvas.width / 2, this.canvas.height);
            this.ctx.restore();
        }else{
            // Draw boundary
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }
    
    /**
     * Draw grid
     */
    drawGrid() {
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        this.ctx.lineWidth = 1;
        
        // Vertical lines
        for (let x = 0; x <= Config.GRID_WIDTH; x++) {
            this.ctx.beginPath();
            this.ctx.moveTo(x * Config.TILE_SIZE, 0);
            this.ctx.lineTo(x * Config.TILE_SIZE, this.canvas.height);
            this.ctx.stroke();
        }
        
        // Horizontal lines
        for (let y = 0; y <= Config.GRID_HEIGHT; y++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y * Config.TILE_SIZE);
            this.ctx.lineTo(this.canvas.width, y * Config.TILE_SIZE);
            this.ctx.stroke();
        }
    }
    
    /**
     * Draw preview placement box
     */
    drawPreview() {
        const { x, y } = this.mouseGridPos;
        
        // First row prohibits placement, player cannot be placed on second screen
        if (this.isProhibitedArea(x, y)) {
            // Draw red prohibition box
            this.ctx.strokeStyle = '#FF0000';
            this.ctx.lineWidth = 3;
            this.ctx.strokeRect(
                x * Config.TILE_SIZE,
                y * Config.TILE_SIZE,
                Config.TILE_SIZE,
                Config.TILE_SIZE
            );
            
            // Draw prohibition marker
            this.ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
            this.ctx.fillRect(
                x * Config.TILE_SIZE,
                y * Config.TILE_SIZE,
                Config.TILE_SIZE,
                Config.TILE_SIZE
            );
            
            return;
        }
        
        // Door is 2x2 cells, needs special handling
        if (this.currentTool === 'door') {
            // Draw 2x2 highlight box
            this.ctx.strokeStyle = '#FFD700';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(
                x * Config.TILE_SIZE,
                y * Config.TILE_SIZE,
                Config.TILE_SIZE * 2,
                Config.TILE_SIZE * 2
            );
            
            // Draw semi-transparent preview
            this.ctx.globalAlpha = 0.5;
            if (this.images.get(Config.DOOR)) {
                this.ctx.drawImage(
                    this.images.get(Config.DOOR),
                    x * Config.TILE_SIZE,
                    y * Config.TILE_SIZE,
                    Config.TILE_SIZE * 2,
                    Config.TILE_SIZE * 2
                );
            }
            this.ctx.globalAlpha = 1.0;
        } else if (this.currentTool === 'enemy' && this.currentEnemyId) {
            const realId = Enemy.getRealId(this.currentEnemyId);

            // Enemy preview - draw based on config size
            const enemyName = Config.ENEMY_PREFIX + `${realId}`;
            const sizeConfig = Config.RESOURCE_IMG_CONFIG[enemyName];
            const widthInTiles = sizeConfig ? sizeConfig.imgBlockIndex[0].length / 2 : 1;
            const heightInTiles = sizeConfig ? sizeConfig.imgBlockIndex.length / 2 : 1;
            
            // Tall enemies use bottom as coordinate, preview box should display upward
            const previewY = y - heightInTiles + 1;
            
            // Draw highlight box
            this.ctx.strokeStyle = '#FFD700';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(
                x * Config.TILE_SIZE,
                previewY * Config.TILE_SIZE,
                Config.TILE_SIZE * widthInTiles,
                Config.TILE_SIZE * heightInTiles
            );
            // Draw semi-transparent preview

            this.ctx.globalAlpha = 0.5;
            if( x > Config.GRID_WIDTH / 2 ){
                this.currentEnemyId = (this.currentEnemyId | 0x80)
            }else{
                this.currentEnemyId = (this.currentEnemyId & 0x7F)

            }

            const facingReverse = Enemy.getFacing(this.currentEnemyId);
            // If reversed, draw image reversed

            const img = this.images.get(enemyName);
            
            if (img) {
                if(!facingReverse){
                    this.ctx.save();
                    this.ctx.translate((x + widthInTiles) * Config.TILE_SIZE, 0);
                    this.ctx.scale(-1, 1);
                    this.ctx.drawImage(
                        img,
                        0,
                        previewY * Config.TILE_SIZE,
                        widthInTiles * Config.TILE_SIZE,
                        heightInTiles * Config.TILE_SIZE
                    );
                    this.ctx.restore();
                }else{
                    this.ctx.drawImage(
                        img,
                        x * Config.TILE_SIZE,
                        previewY * Config.TILE_SIZE,
                        Config.TILE_SIZE * widthInTiles,
                        Config.TILE_SIZE * heightInTiles
                    );
                }

            }
            
            this.ctx.globalAlpha = 1.0;
            
        } else {

            // Other tools: draw 1x1 highlight box
            this.ctx.strokeStyle = '#FFD700';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(
                x * Config.TILE_SIZE,
                y * Config.TILE_SIZE,
                Config.TILE_SIZE,
                Config.TILE_SIZE
            );
            
            // Draw semi-transparent preview
            this.ctx.globalAlpha = 0.5;
            const tileName = Config.TILE_PREFIX + `${this.currentTileId}`;
            if (this.currentTool === 'tile' && this.currentTileId && this.images.get(tileName)) {
                this.ctx.drawImage(
                    this.images.get(tileName),
                    x * Config.TILE_SIZE,
                    y * Config.TILE_SIZE,
                    Config.TILE_SIZE,
                    Config.TILE_SIZE
                );
            } else if (this.currentTool === 'player' && this.images.get(Config.PLAYER)) {
                this.ctx.drawImage(
                    this.images.get(Config.PLAYER),
                    x * Config.TILE_SIZE,
                    y * Config.TILE_SIZE,
                    Config.TILE_SIZE,
                    Config.TILE_SIZE
                );
            }
            
            this.ctx.globalAlpha = 1.0;

        }
    }

    updateDataDisplays(){
        const levelEditorData = app.getLevelEditorData();
        if(!levelEditorData){
            return;
        }
        const levelRomData = DataConverter.fromLevelEditorToROMData(levelEditorData, this.isWideScreen);
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
        let rows = Config.GRID_HEIGHT;
        let cols = this.isWideScreen ? Config.GRID_WIDTH : Config.GRID_WIDTH / 2;

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
