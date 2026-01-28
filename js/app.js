/**
 * Main application logic
 */
class App {
    constructor() {
        this.romEditor = new RomEditor();
        this.levelEditor = new LevelEditor('levelCanvas');
        //this.converter = new DataConverter();
        this.currentLevel = 0;
        this.fileName = '';
        this.draggedIndex = -1;
        this.dropTargetIndex = -1;
        this.isEditingLevels = false;
        this.levelsListChanged =false;

        this.hasSharedLevelLoaded = false;

        this.testMode = false;
        this.romCache = RomCache.getInstance();

        // Message box data
        this.messageSet = new Set();
        
        // Mobile game controller (lazy initialization)
        this.mobileController = null;
        
        // iOS specific optimizations
        this.applyIOSFixes();
        
        this.initEventListeners();
        this.initCache();
       
        // Six main buttons
        this.testLevelBtn = document.getElementById('testLevelBtn');
        this.testBtn = document.getElementById('testBtn');
        this.stopEmulatorBtn = document.getElementById('stopEmulatorBtn');
        this.saveBtn = document.getElementById('saveBtn');
        this.writeRomBtn = document.getElementById('writeRomBtn');
        this.downloadBtn = document.getElementById('downloadBtn');

        this.sortable = null;
        //
        this.toggleInfoItems(false);
    }
    
    /**
     * Apply iOS specific fixes
     */
    applyIOSFixes() {
        const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        if (isIOS) {
            // Add iOS marker class to body
            document.body.classList.add('ios-device');
            
            // Force recalculate viewport
            setTimeout(() => {
                window.scrollTo(0, 0);
                // Trigger a resize event to ensure correct layout
                window.dispatchEvent(new Event('resize'));
            }, 100);
        }
    }

    /**
     * Initialize cache and try to auto-load
     */
    async initCache() {
        try {
            await this.romCache.init();
            const cachedRom = await this.romCache.loadRom();
            
            if (cachedRom) {
                // Auto-load cached ROM
                this.loadRomData(cachedRom.data, cachedRom.fileName, true);
                //this.initParams();
                //this.selectLevel(this.currentLevel);
                this.showMessage('info', i18n.t('loadedFromCacheMessage', {fileName: cachedRom.fileName}));
            }else{
                const urlParams = new URLSearchParams(window.location.search);
                const mapDataParam = urlParams.get("mapData");
                if(mapDataParam != null){
                    this.showMessage('warning', i18n.t('romNotFoundWarning'));
                }
               
            }
        } catch (error) {
            console.error('Failed to initialize cache:', error);
        }
    }

    initParams(){
        // Binary decode function: Base64 URL-Safe -> Uint8Array -> Array
        function decodeBase64UrlSafe(str) {
            if (!str) return null;
            
            // 1. Restore standard Base64
            let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
            const padLength = (4 - base64.length % 4) % 4;
            base64 += '='.repeat(padLength);
            
            // 2. Decode Base64 to binary string
            const binaryString = atob(base64);
            
            // 3. Convert to Uint8Array
            const uint8Array = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
            }
            
            // 4. Convert to plain array
            return Array.from(uint8Array);
        }
        
        const urlParams = new URLSearchParams(window.location.search);
        const mapDataParam = urlParams.get("mapData");
        const enemyDataParam = urlParams.get("enemyData");
        
        // Check if parameters exist
        if (!mapDataParam || !enemyDataParam) {
            console.log("No level data parameters in URL");
            return;
        }
        
        try {
            const mapData = decodeBase64UrlSafe(mapDataParam);
            const enemyData = decodeBase64UrlSafe(enemyDataParam);
            
            // Validate data
            if (!Array.isArray(mapData) || !Array.isArray(enemyData)) {
                console.error("Parsed data format is incorrect");
                return;
            }
            
            console.log('✅ Parsed map data:', mapData);
            console.log('✅ Parsed enemy data:', enemyData);
            
            const data = {
                mapData: mapData,
                monsterData: enemyData,
            };
            
            // Check if ROM is loaded
            if (this.romEditor.romData == null) {
                console.log("Data not ready, waiting for ROM to load...");
                
                // Delay execution, wait for ROM to load
                const checkInterval = setInterval(() => {
                    if (this.romEditor.romData != null) {
                        clearInterval(checkInterval);
                        this.loadSharedLevel(data);
                    }
                }, 100);
                return;
            }
            
            // ROM already loaded, load level directly
            this.loadSharedLevel(data);
            
        } catch (error) {
            console.error('❌ Failed to parse URL parameters:', error);
            this.showMessage('error', i18n.t('loadShareLevelError'));
        }
    }
    
    /**
     * Load shared level
     */
    loadSharedLevel(data) {
        if(this.changeMode()){
            return;
        }
        const tmpRomData = this.createTmpRomData(data);
        // const editorSection = document.getElementById('editorSection');
        // editorSection.classList.add('active');
        

        // Create emulator and load temporary ROM
        if (!this.emulator) {
            this.emulator = new NesEmulator('levelCanvas');
        }
        this.hasSharedLevelLoaded = true;
        this.levelEditor.testMode = true;
        this.emulator.loadROM(tmpRomData);
        this.emulator.start();
        this.showMessage('success', i18n.t('loadSharedLevelSuccess'));
        
    }
    
    /**
     * Initialize event listeners
     */
    initEventListeners() {
        document.getElementById('fileInput').addEventListener('change', 
            (e) => this.handleFileSelect(e));

        // Initialize toolbar drag functionality
        this.initToolbarDragging();
        
        // Level list drawer toggle
        const sidebarToggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebar');
        if (sidebarToggle && sidebar) {
            sidebarToggle.addEventListener('click', () => {
                sidebar.classList.toggle('open');
                sidebarToggle.classList.toggle('sidebar-open');
            });
        }

        // Toolbar drawer toggle
        const toolbarToggle = document.getElementById('toolbarToggle');
        const toolbar = document.querySelector('.toolbar');
        if (toolbarToggle && toolbar) {
            toolbarToggle.addEventListener('click', () => {
                toolbar.classList.toggle('open');
                toolbarToggle.classList.toggle('toolbar-open');
            });
        }
        
        // Level count input box
        const levelCountInput = document.getElementById('levelCountInput');
        if (levelCountInput) {
            // Use input event for real-time monitoring
            levelCountInput.addEventListener('input', (e) => {
                const count = parseInt(e.target.value);
                // Only update when a complete valid number is entered
                if (!isNaN(count) && count >= 1 && count <= 255) {
                    this.romEditor.setLevelCount(count);
                    this.levelsListChanged = true;
                }
            });
            
            // Validate and correct invalid values on blur
            levelCountInput.addEventListener('blur', (e) => {
                const count = parseInt(e.target.value);
                if (isNaN(count) || count < 1 || count > 255) {
                    this.showMessage('error', i18n.t('invalidLevelCountMessage'));
                    e.target.value = this.romEditor.getLevelCount();
                }
            });
            
            // Prevent non-numeric character input
            levelCountInput.addEventListener('keypress', (e) => {
                if (e.key && !/[0-9]/.test(e.key)) {
                    e.preventDefault();
                }
            });
        }
        
        // Clear cache button
        const clearCacheBtn = document.getElementById('clearCacheBtn');
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('click', async () => {
                await this.clearCache();
            });
        }
    }

    async clearCache() {
        if (confirm(i18n.t('clearRomCacheConfirm'))) {
            try {
                await this.romCache.clearCache();
                this.showMessage('success', i18n.t('cacheCleanSuccess'));
                
                // Update button state
                const romSelectBtn = document.getElementById('romSelectBtn');
                if (romSelectBtn) {
                    romSelectBtn.textContent = i18n.t('selectNesRomFile');
                    romSelectBtn.classList.remove('loaded');
                    romSelectBtn.title = '';
                }
            } catch (error) {
                this.showMessage('error', i18n.t('cacheCleanError'));
                console.error(error);
            }
        }
    }

    /**
     * Handle file selection
     */
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.fileName = file.name;
        const reader = new FileReader();
        
        reader.onload = async (e) => {
            this.loadRomData(e.target.result, file.name, false);
            
            // Save to cache
            try {
                await this.romCache.saveRom(e.target.result, file.name);
            } catch (error) {
                console.error('Failed to save to cache:', error);
            }
        };
        
        reader.readAsArrayBuffer(file);
    }
    
    /**
     * Initialize toolbar dragging functionality
     */
    initToolbarDragging() {
        const toolbar = document.getElementById('toolbar');
        if (!toolbar) return;
        
        let isDragging = false;
        let startMouseX, startMouseY;
        let startLeft, startTop;
        
        // Mouse events
        toolbar.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);
        
        // Touch events
        toolbar.addEventListener('touchstart', dragStart, { passive: true });
        document.addEventListener('touchmove', drag, { passive: false });
        document.addEventListener('touchend', dragEnd);
        
        function dragStart(e) {
            // Only enable dragging in drag mode
            if (!toolbar.classList.contains('draggable-mode')) {
                return;
            }
            
            // Don't start dragging if clicking on buttons or interactive elements
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) {
                return;
            }
            
            // Get current toolbar position
            const rect = toolbar.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            
            if (e.type === 'touchstart') {
                startMouseX = e.touches[0].clientX;
                startMouseY = e.touches[0].clientY;
            } else {
                startMouseX = e.clientX;
                startMouseY = e.clientY;
            }
            
            isDragging = true;
            toolbar.style.cursor = 'grabbing';
            // Transition controlled by CSS .draggable-mode class, not set here
        }
        
        function drag(e) {
            if (!isDragging) return;
            
            e.preventDefault();
            
            let currentMouseX, currentMouseY;
            if (e.type === 'touchmove') {
                currentMouseX = e.touches[0].clientX;
                currentMouseY = e.touches[0].clientY;
            } else {
                currentMouseX = e.clientX;
                currentMouseY = e.clientY;
            }
            
            // Calculate new position
            let newLeft = startLeft + (currentMouseX - startMouseX);
            let newTop = startTop + (currentMouseY - startMouseY);
            
            // Limit drag range to prevent toolbar from being dragged off screen
            const minX = 10;
            const minY = 10;
            const maxX = window.innerWidth - toolbar.offsetWidth - 10;
            const maxY = window.innerHeight - toolbar.offsetHeight - 10;
            
            newLeft = Math.max(minX, Math.min(maxX, newLeft));
            newTop = Math.max(minY, Math.min(maxY, newTop));
            
            toolbar.style.left = newLeft + 'px';
            toolbar.style.top = newTop + 'px';
        }
        
        function dragEnd() {
            if (!isDragging) return;
            isDragging = false;
            toolbar.style.cursor = '';
        }
    }
    
    /**
     * Load ROM data (unified handling for file upload and cache loading)
     * @param {ArrayBuffer} data - ROM data
     * @param {string} fileName - File name
     * @param {boolean} fromCache - Whether from cache
     */
    loadRomData(data, fileName, fromCache = false) {
        this.fileName = fileName;
        this.romEditor.loadROM(data);
        
        // Hide welcome overlay
        this.hideWelcomeOverlay();
        
        // Load image resources
        ResourceManager.getInstance().initResources(this.romEditor.romData, this.romEditor.palettes);
        this.levelEditor.createButtons();
        levelCountInput.value = this.romEditor.getLevelCount();
        this.createLevelList();
        this.updateMemoryOverview();
        // const editorSection = document.getElementById('editorSection');
        // editorSection.classList.remove('active');
        if (!fromCache) {
            //this.showMessage('success', `File loaded successfully: ${fileName} (${this.romEditor.romData.length} bytes)`);
            this.showMessage('success', i18n.t("loadFileSuccess",{fileNameStr: fileName, length: this.romEditor.romData.length}));
        }
        
        // Update button to display filename
        const romSelectBtn = document.getElementById('romSelectBtn');
        if (romSelectBtn) {
            romSelectBtn.textContent = `📁 ${fileName}`;
            romSelectBtn.classList.add('loaded');
            romSelectBtn.title = `${fileName} (${this.romEditor.romData.length} Byte)`;
        }

        this.testLevelBtn.disabled = true;
        this.saveBtn.disabled = true;
        this.writeRomBtn.disabled = true;
        this.testBtn.disabled = true;
        this.downloadBtn.disabled = true;

        if(!this.hasSharedLevelLoaded){
            this.initParams();
        }
    }
    
    /**
     * Hide welcome overlay
     */
    hideWelcomeOverlay() {
        const welcomeOverlay = document.getElementById('welcomeOverlay');
        if (welcomeOverlay) {
            welcomeOverlay.classList.add('hidden');
        }
    }

    // Create level list
    createLevelList(){
        const listElement = document.getElementById('levelList');
        // Clear list
        listElement.innerHTML = '';
        
        // Destroy old Sortable instance to avoid duplicate bindings that prevent mobile re-dragging
        if (this.sortable) {
            this.sortable.destroy();
            this.sortable = null;
        }

        const levels = this.romEditor.getAllLevels();
        
        // Show sidebar toggle button and main layout
        document.getElementById('mainLayout').style.display = 'flex';
        document.getElementById('sidebarToggle').style.display = 'flex';
        
        // Toolbar drawer button: only show in non-drag mode
        const toolbarToggleBtn = document.getElementById('toolbarToggle');
        const toolbarEl = document.getElementById('toolbar');
        if (toolbarToggleBtn && toolbarEl) {
            if (!toolbarEl.classList.contains('draggable-mode')) {
                toolbarToggleBtn.style.display = 'flex';
            }
        }
        
        // Disable level count input (only enabled in edit mode)
        const levelCountInput = document.getElementById('levelCountInput');
        if (levelCountInput) {
            //levelCountInput.value = this.romEditor.getLevelCount();
            levelCountInput.disabled = true;
        }

        if(levelCountInput.value > levels.length){
            // Create extra levels
            const levelCountInputValue = parseInt(levelCountInput.value, 10);
            this.romEditor.setLevelCount(levelCountInputValue);
            for(let i = levels.length; i < levelCountInputValue; i++){
                const newLevel = new Level(i);
                levels.push(newLevel);
            }
        }

        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            // Skip deleted levels
            if (level.isDeleted) {
                continue;
            }
           level.htmlItem = this.createLevelItem(level, i);
           level.htmlItem.classList.add('no-drag');
           listElement.append(level.htmlItem);
        }

        this.sortable = new Sortable(listElement, {
            swapThreshold: 1,
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            filter: '.no-drag',
            handle: '.drag-handle',
            // Mobile optimization
            forceFallback: false,
            fallbackTolerance: 5,
            delay: 100,
            delayOnTouchOnly: true,
            touchStartThreshold: 5,
            // Prevent scroll conflict
            preventOnFilter: false,
            onEnd: function(evt) {
                // If position unchanged, return directly
                if (evt.oldIndex === evt.newIndex) {
                    return;
                }
                
                // Update levels array order
                const [movedLevel] = app.romEditor.levels.splice(evt.oldIndex, 1);
                app.romEditor.levels.splice(evt.newIndex, 0, movedLevel);
                
                // Update all levels' index and dataset.index
                for (let i = 0; i < app.romEditor.levels.length; i++) {
                    app.romEditor.levels[i].index = i;
                    if (app.romEditor.levels[i].htmlItem) {
                        app.romEditor.levels[i].htmlItem.dataset.index = i;
                    }
                }
                
                // Mark order as changed
                app.levelsListChanged = true;
                
                // Update currently selected level index
                if (app.currentLevel === evt.oldIndex) {
                    app.currentLevel = evt.newIndex;
                } else if (evt.oldIndex < app.currentLevel && evt.newIndex >= app.currentLevel) {
                    app.currentLevel--;
                } else if (evt.oldIndex > app.currentLevel && evt.newIndex <= app.currentLevel) {
                    app.currentLevel++;
                }
            }
            });
    }

    createLevelItem(level, index){
        const item = document.createElement('div');
        //item.className = (index === levels.length) ? 'add-level-item' : 'level-item';
        item.className = 'level-item';
        if(level.isDeleted){
            item.classList.add('deleted-level');
        }
        item.dataset.index =index;
        
        // Create drag handle
        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle';
        dragHandle.textContent = '⋮⋮';
        dragHandle.style.display = 'none'; // Hidden by default
    
        item.appendChild(dragHandle);

        // Create clickable content area
        const content = document.createElement('div');
        content.className = 'level-content';
        
        // Track touch position to prevent accidental clicks during scrolling
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;
        
        content.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
        }, { passive: true });
        
        content.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const touchEndTime = Date.now();
            
            // Calculate swipe distance
            const deltaX = Math.abs(touchEndX - touchStartX);
            const deltaY = Math.abs(touchEndY - touchStartY);
            const deltaTime = touchEndTime - touchStartTime;
            
            // Only consider it a click if distance < 10px and time < 300ms
            if (deltaX < 10 && deltaY < 10 && deltaTime < 300) {
                e.preventDefault();
                e.stopPropagation();
                this.selectLevel(index);
            }
        }, { passive: false });
        
        // Keep click event for desktop
        content.onclick = (e) => {
            if (!('ontouchstart' in window)) {
                this.selectLevel(index);
            }
        };

        let levelLabel = i18n.t('levelLabel', {level: level.getLevelNumber()});

        
        content.innerHTML = `
            <span class="level-wrapper ${level.isDragged() ? 'dragged' : ''}" style="position:relative;display:block;">
                <span class="level-num">${levelLabel}</span>
            </span>
            <span class="level-info">${level.getDataSize()} B</span>
        `;
        item.appendChild(content);
        return item;
        //listElement.appendChild(item);
    }

    /**
     * Select level for editing
     */
    selectLevel(index) {
        if(index === -1){
            app.showMessage('warning', "");
            //app.showMessage('warning', i18n.t("rom"));
            return;
        }
        this.currentLevel = index;
        const level = this.romEditor.getLevel(index);
        
        // Update selection state
        const items = document.querySelectorAll('.level-item');
        items.forEach((item, i) => {
            item.classList.toggle('active', i === index);
        });

        // Show editor
        // const editorSection = document.getElementById('editorSection');
        // editorSection.classList.add('active');
        //editorSection.scrollIntoView({ behavior: 'smooth' });

        // Update editor content
        // document.getElementById('editorTitle').textContent = 
        //     `Edit Level ${level.getLevelNumber()}`;
        document.getElementById('romAddress').textContent = 
            level.getRomAddressString();
        document.getElementById('cpuAddress').textContent = 
            level.getCpuAddressString();
        document.getElementById('monsterRomAddress').textContent = 
            level.getMonsterRomAddressString();
        document.getElementById('monsterCpuAddress').textContent = 
            level.getMonsterCpuAddressString();
        document.getElementById('hexData').value = level.getHexString();
        document.getElementById('monsterData').value = level.getMonsterHexString();

        //this.updateDataSize();
        this.validateMonsterData();
        
        // Load data to visual editor
        this.loadLevelToVisualEditor(level);

        this.testLevelBtn.disabled = false;;
        this.testBtn.disabled = false;;
        
        // Show/hide visual edit button
        //document.getElementById('visualEditBtn').style.display = 'inline-block';
    }
    
    /**
     * Load level data to visual editor
     */
    loadLevelToVisualEditor(level) {
        try {
            // Get level data (Level class uses data and monsterData properties)
            const mapData = level.data;
            const monsterData = level.monsterData;
            
            // Convert to visual editor format
            const editorData = DataConverter.fromROMtoEditor(mapData, monsterData);
            
            // Load to visual editor
            if (this.levelEditor) {
                this.levelEditor.loadFromData(editorData, this.currentLevel);
            }
        } catch (error) {
            console.error('Failed to load level to visual editor:', error);
        }
    }

    // Toggle info bar display state
    toggleInfoItems(showOperation) {
        const operationItem = document.getElementById('operationInfoItem');
        const toolItem = document.getElementById('currentToolInfoItem');
        const mouseItem = document.getElementById('mousePositionInfoItem');
        
        if (showOperation) {
            // Test mode: show operation info, hide tool and mouse info
            operationItem?.classList.add('active');
            toolItem?.classList.remove('active');
            mouseItem?.classList.remove('active');
        } else {
            // Edit mode: hide operation info, show tool and mouse info
            operationItem?.classList.remove('active');
            toolItem?.classList.add('active');
            mouseItem?.classList.add('active');
        }
    }

    // Change mode, exit if in test mode
    changeMode(){
        this.levelEditor.testMode = !this.testMode
        if(this.testMode){
            this.testMode = false;
            this.emulator.stop();
            this.levelEditor.render();
            this.toggleInfoItems(false); // Switch to edit mode display
            
            // Remove test mode class, restore normal size
            // const canvasContainer = document.querySelector('.canvas-container');
            // if (canvasContainer) {
            //     canvasContainer.classList.remove('test-mode');
            // }

            const levelCanvas = document.getElementById('levelCanvas');
            if (levelCanvas) {
                levelCanvas.classList.remove('test-mode');
            }

            const editorLayout = document.querySelector('.editor-layout');
            if (editorLayout) {
                editorLayout.classList.remove('test-mode');
            }
            
            // Remove body's test-mode class
            document.body.classList.remove('test-mode');
            
            // Hide mobile control panel
            if (this.mobileController) {
                this.mobileController.hide();
            }
            
            // Restore button status
            if (this.currentLevel >= 0) {
                this.testLevelBtn.disabled = false;
                this.saveBtn.disabled = this.levelEditor.modified ? false : true;
                this.writeRomBtn.disabled = this.romEditor.modified ? false : true;
                this.testBtn.disabled = false;
            }else{
                this.saveBtn.disabled = true;
                this.writeRomBtn.disabled =  true;
                this.downloadBtn.disabled = false;
            }
            this.stopEmulatorBtn.disabled = true;
            return true;
        }else{
            //this.stopEmulatorBtn.disabled = false;
            this.toggleInfoItems(true); // Switch to test mode display
        }
        this.testMode = true;
        return false;
    }
    
    // Stop emulator
    stopEmulator() {
        if (!this.testMode) {
            this.showMessage('warning', i18n.t("emulatorNotRunningWarning"));
            return;
        }
        
        // Remove test mode class, restore normal size
        // const canvasContainer = document.querySelector('.canvas-container');
        // if (canvasContainer) {
        //     canvasContainer.classList.remove('test-mode');
        // }

        const levelCanvas = document.getElementById('levelCanvas');
        if (levelCanvas) {
            levelCanvas.classList.remove('test-mode');
        }

        const editorLayout = document.querySelector('.editor-layout');
        if (editorLayout) {
            editorLayout.classList.remove('test-mode');
        }
        
        // Remove body's test-mode class
        document.body.classList.remove('test-mode');
        
        // Hide mobile control panel
        if (this.mobileController) {
            this.mobileController.hide();
        }
        
        this.changeMode();
        this.showMessage('info', i18n.t("emulatorStopInfo"));
    }

    // Share current level
    shareLevel(){
        if(this.currentLevel === -1){
            this.showMessage('warning', i18n.t("pleaseSelectLevelFirstWarning"));
            return;
        }
        
        // Binary encode function: Array -> Uint8Array -> Base64 URL-Safe
        function encodeDataBinary(dataArray) {
            // Convert number array to Uint8Array
            const uint8Array = new Uint8Array(dataArray);
            
            // Convert to binary string
            let binaryString = '';
            for (let i = 0; i < uint8Array.length; i++) {
                binaryString += String.fromCharCode(uint8Array[i]);
            }
            
            // Base64 encode (URL safe)
            return btoa(binaryString)
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
        }
        
        try {
            const tmpEditorData = this.getLevelEditorData();
            if(!tmpEditorData){
                return;
            }
            const levelRomData = DataConverter.fromLevelEditorToROMData(tmpEditorData, this.levelEditor.isWideScreen);

            // Get current page full URL
            const url = new URL(window.location.href);
            
            // Clear other possible parameters to avoid conflicts
            url.searchParams.delete('level');

            // Set parameters (use binary encoding, shorter and more efficient)
            url.searchParams.set("mapData", encodeDataBinary(levelRomData.mapData));
            url.searchParams.set("enemyData", encodeDataBinary(levelRomData.monsterData));

            const shareUrl = url.toString();

            // Copy to clipboard
            navigator.clipboard.writeText(shareUrl)
                .then(() => {
                    this.showMessage('success', i18n.t("copyShareLevelLinkSuccess"));
                    console.log('Share URL:', shareUrl);
                    console.log('URL length:', shareUrl.length);
                })
                .catch(err => {
                    console.error("Copy failed:", err);
                    prompt("Copy failed, please copy manually:", shareUrl);
                });
        } catch (error) {
           // console.error('Failed to generate share link:', error);
            this.showMessage('error', i18n.t("copyShareLevelLinkError",{error: error}));
        }
    }

    createTmpRomData(levelRomData){
        const tmpLevel = new Level(0, 0, 0);
        tmpLevel.saveMapData(levelRomData.mapData);
        tmpLevel.saveMonsterData(levelRomData.monsterData);
        const addresses = this.romEditor.readAddressTable();
        tmpLevel.cpuAddress = addresses[0].cpuAddress;
        tmpLevel.romAddress = addresses[0].romAddress;
        const tmpLevels = [];
        tmpLevels.push(tmpLevel);
        
        // Deep copy romEditor.romData (Uint8Array)
        const romData = new Uint8Array(this.romEditor.romData);
        // Write temporary level to copied ROM data
        RomEditor.writeToROM(romData, tmpLevels, 1);
        return romData;
    }

    // Test current level
    async testLevel(){
        if(this.changeMode()){
            return;
        }

        // Build temp level
        // Create a new romData, then put current level as first level
        // Change level count to 1
        const tmpEditorData = this.getLevelEditorData();
        if(!tmpEditorData){
            this.changeMode();
            return;
        }
        const levelRomData = DataConverter.fromLevelEditorToROMData(tmpEditorData, this.levelEditor.isWideScreen);
        const romData = this.createTmpRomData(levelRomData);

        
        // Create emulator and load temp ROM
        if (!this.emulator) {
            this.emulator = new NesEmulator('levelCanvas');
        }
        
        this.emulator.loadROM(romData);
        
        this.emulator.quickStart();

        this.testLevelBtn.disabled = true;
        this.saveBtn.disabled =  true;
        this.writeRomBtn.disabled = true;
        this.testBtn.disabled = true;
        this.downloadBtn.disabled = true;
        //this.stopEmulatorBtn.disabled = false;


        this.showMessage('success', i18n.t("testingCurrentLevelSuccess"));
    }

    // Add test ROM method
    testROM() {
        if(this.changeMode()){
            return;
        }
        if (!this.romEditor.romData) {
            this.showMessage('error', i18n.t("romNotLoadedError"));
            return;
        }
        
        if (!this.emulator) {
            this.emulator = new NesEmulator('levelCanvas');
        }
        
        this.emulator.loadROM(this.romEditor.romData);
        this.emulator.start();

        this.testLevelBtn.disabled = true;
        this.saveBtn.disabled = true;
        this.writeRomBtn.disabled = true;
        this.testBtn.disabled = true;
        this.downloadBtn.disabled = true;
        //this.stopEmulatorBtn.disabled = false;

        this.showMessage('success', i18n.t("emulatorStartSuccess"));

    }

    getLevelEditorData(){
        if (this.currentLevel === -1) return;
        
        // Get data from visual editor
        if (!this.levelEditor) {
            this.showMessage('error', i18n.t("editorNotInitError"));
            return;
        }

        // Ensure no 15 consecutive 0xF data
        if(!checkConsecutiveMoai(this.levelEditor.optimizedMapData, this.levelEditor.isWideScreen)){
            this.showMessage('error', i18n.t("consecutiveMoaiError"));
            return;
        }
        
        // Get editor data
        let bgId = parseInt(this.levelEditor.currentBgId) +  (this.levelEditor.isWideScreen ? 16 : 0);
        
        const editorData = {
            background: bgId,
            map: this.levelEditor.optimizedMapData,
            player: this.levelEditor.playerPos,
            door: this.levelEditor.doorPos,
            enemies: this.levelEditor.enemies
        };

        return editorData;
    }

    /**
     * Save current level
     */
    saveLevel() {
        const levelEditorData = this.getLevelEditorData();

        if (!levelEditorData) {
            return;
        }
        try {
            // Convert to ROM format
            const levelromData = DataConverter.fromLevelEditorToROMData(levelEditorData, this.levelEditor.isWideScreen);
            
            console.log('Converted ROM data:', {
                mapDataLength: levelromData.mapData.length,
                monsterDataLength: levelromData.monsterData.length,
                monsterData: levelromData.monsterData
            });
            

            // Save to ROM
            const level = this.romEditor.getLevel(this.currentLevel);
            const result = level.saveMapData(levelromData.mapData);
            if (!result) {
                this.showMessage('error', i18n.t("saveMapFailedError"));
                return;
            }
            
            // Save monster data
            const monsterResult = level.saveMonsterData(levelromData.monsterData);
            if (!monsterResult.success) {
                //this.showMessage('error', 'Monster data error: ' + monsterResult.error);
                this.showMessage('error', i18n.t("monsterDataError",{error:monsterResult.error}));
                return;
            }
            
            //document.getElementById('downloadBtn').disabled = false;
            //this.showMessage('success', `Level ${this.currentLevel + 1} saved successfully! Map and monster data updated.`);
            this.showMessage('success', i18n.t("saveMapSuccess", {currentLevel: this.currentLevel + 1}));
            
            // Write level info to ROM data

            this.romEditor.updateRomData()
            // Save to cache
            this.romCache.saveRom(this.romEditor.romData, this.fileName).catch((error) => {
                console.error('Failed to save to cache:', error);
            });

            // Refresh display
            this.selectLevel(this.currentLevel);
            this.updateMemoryOverview();
            this.writeRomBtn.disabled = false;
            level.modified = true;
            this.saveBtn.disabled = true;
        } catch (error) {
            //console.error('Failed to save level:', error);
            //this.showMessage('error', 'Save failed: ' + error.message);
            this.showMessage('error', i18n.t("saveLevelFailedError",{error: error.message}));
        }
    }

    /**
     * Write to ROM (write all modifications to ROM data)
     */
    writeToROM() {
        try {
            this.romEditor.recalculateAddresses(this.romEditor.levels);
            RomEditor.writeToROM(this.romEditor.romData, this.romEditor.levels, this.romEditor.levelCount);
            
            // Save to cache
            this.romCache.saveRom(this.romEditor.romData, this.fileName).catch((error) => {
                console.error('Failed to save to cache:', error);
            });

            this.romEditor.modified = false;
            this.showMessage('success', i18n.t("write2RomSuccess"));
            //console.log('ROM data written successfully');
        } catch (error) {
            //console.error('Failed to write to ROM:', error);
            this.showMessage('error', i18n.t("write2RomFiledError", {error: error.message}));
        }
    }
    /**
     * Download modified ROM
     */
    downloadROM() {
        //if (!this.romEditor.isModified()) return;

        const blob = new Blob([this.romEditor.getROMData()], { 
            type: 'application/octet-stream' 
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.fileName.replace('.nes', ' - Modified.nes');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showMessage('success', i18n.t("romDownloadSuccess"));
    }

    /**
     * Show message
     */
    showMessage(type, text) {
        console.log(`${type.toUpperCase()}: ${text}`);
        if(this.messageSet.has(text)){
            return;
        }
        this.messageSet.add(text);
        // Get or create message container
        let container = document.getElementById('messageContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'messageContainer';
            container.className = 'message-container';
            document.body.appendChild(container);
        }
        
        // Create message element
        const message = document.createElement('div');
        message.className = `message-toast ${type}`;
        
        // Add icon
        const icon = document.createElement('div');
        icon.className = 'message-toast-icon';
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        icon.textContent = icons[type] || '🔔';
        
        // Add text
        const textElement = document.createElement('div');
        textElement.className = 'message-toast-text';
        textElement.textContent = text;
        
        message.appendChild(icon);
        message.appendChild(textElement);
        container.appendChild(message);
        
        // Decide display duration based on screen width: 2s for mobile, 5s for desktop
        const isMobile = window.matchMedia('(pointer: coarse)').matches;
        const displayTime = isMobile ? 2000 : 5000;
        
        // Auto-hide after display
        setTimeout(() => {
            message.classList.add('hiding');
            setTimeout(() => {
                this.messageSet.delete(text);
                message.remove();
                // Remove container if empty
                if (container.children.length === 0) {
                    container.remove();
                }
            }, 300); // Wait for exit animation to complete
        }, displayTime);
    }

    /**
     * Hide message
     */
    hideMessage(type) {
        // const msgElement = document.getElementById(type + 'Msg');
        // msgElement.classList.remove('show');
    }

    /**
     * Update memory usage overview
     */
    updateMemoryOverview() {
        const levels = this.romEditor.getAllLevels();
        if (levels.length === 0) return;

        const firstLevelStart = levels[0].romAddress;
        const maxSize = Config.DATA_START_MAX - firstLevelStart;
        const usedSize = this.romEditor.calculateTotalSize();
        //const freeSize = maxSize - usedSize;
        const percentage = ((usedSize / maxSize) * 100).toFixed(1);

        // Update progress bar
        document.getElementById('memoryBarFill').style.width = `${percentage}%`;
        document.getElementById('memoryBarText').textContent = 
            `${usedSize} / ${maxSize} Byte (${percentage}%)`;

        // Generate segment display
        this.generateMemorySegments(levels, maxSize);

        document.getElementById('memoryOverview').style.display = 'block';
    }

    /**
     * Generate memory segment visualization
     */
    generateMemorySegments(levels, maxSize) {
        const container = document.getElementById('memorySegments');
        container.innerHTML = '';

        // Use different colors
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
            '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B88B', '#AAB7B8'
        ];

        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            const percentage = (level.getTotalSize() / maxSize * 100);
            const color = colors[i % colors.length];

            const segment = document.createElement('div');
            segment.className = 'memory-segment';
            segment.style.width = `${percentage}%`;
            segment.style.backgroundColor = color;
            segment.onclick = () => this.selectLevel(i);

            const tooltip = document.createElement('div');
            tooltip.className = 'memory-segment-tooltip';
            tooltip.textContent = `Level ${level.getLevelNumber()}: ${level.getTotalSize()} Byte`;
            segment.appendChild(tooltip);

            container.appendChild(segment);
        }
    }
    
    /**
     * Update placeholder
     */
    updatePlaceholder() {
        // Remove all placeholders
        document.querySelectorAll('.drop-placeholder').forEach(el => {
            el.classList.remove('drop-placeholder');
        });
        
        if (this.dropTargetIndex >= 0 && this.dropTargetIndex !== this.draggedIndex) {
            const items = document.querySelectorAll('.level-item');
            if (items[this.dropTargetIndex]) {
                items[this.dropTargetIndex].classList.add('drop-placeholder');
            }
        }
    }

    /**
     * Validate monster data format
     */
    validateMonsterData() {
        const monsterInput = document.getElementById('monsterData').value.trim();
        
        if (!monsterInput) {
            return;
        }

        const hexBytes = monsterInput.split(/\s+/).filter(s => s.length > 0);
        
        // Validate hex format
        for (let hex of hexBytes) {
            if (!/^[0-9A-Fa-f]{1,2}$/.test(hex)) {
                return;
            }
        }

        const bytes = hexBytes.map(h => parseInt(h, 16));
        const firstByte = bytes[0];
        
        // Simple validation
        if (firstByte === 0x01) {
            if (bytes.length !== 1) {
                // Warn but don't block
            }
        } else if (firstByte !== bytes.length) {
            // Warn but don't block
        }
    }

    vibrate(ms = 200){
        // First check if this method exists
        // I hate webKit
        if (!("vibrate" in navigator)) {
            console.log("This device/browser does not support vibration");
            return;
        }

        try {
            navigator.vibrate(ms);
        } catch (err) {
            console.log("Vibration blocked", err);
        }
    }
}

// Global app instance
let app;

// Initialize app after page load
document.addEventListener('DOMContentLoaded', () => {
    app = new App();
});

// Global function
function testROM() {
    app.testROM();
}

// Global function
async function testLevel() {
    await app.testLevel();
}

// Global function
function stopEmulator() {
    app.stopEmulator();
}

// Global function for HTML call
function saveLevel() {
    app.saveLevel();
}

function shareLevel(){
    app.shareLevel();
}

function downloadROM() {
    app.downloadROM();
}

function writeToROM() {
    app.writeToROM();
}

async function clearCache(){
    await app.clearCache();
}

/**
 * Start editing level order
 */
function startEditLevels() {
    app.isEditingLevels = true;
    
    // Backup current order (shallow copy array, Level objects keep reference)
    app.originalLevelsOrder = app.romEditor.levels.slice();
    app.levelsListChanged = false;
    
    // Toggle button display
    document.getElementById('editLevelsBtn').style.display = 'none';
    document.getElementById('editLevelsActionButtons').style.display = 'flex';
    
    // Enable level count input
    const levelCountInput = document.getElementById('levelCountInput');
    if (levelCountInput) {
        levelCountInput.disabled = false;
    }

    // Change item to drag style
    for(let i=0; i< app.romEditor.levels.length; i++){
        const level = app.romEditor.getLevel(i);
        const item = level.htmlItem;
        const dragHandle = item.querySelector('.drag-handle');
        if (dragHandle) {
            dragHandle.style.display = 'flex';
        }
        item.classList.remove('no-drag');
    }
}


function hideDragHandle(){
    // Hide dragHandle
    for(let i=0; i< app.romEditor.levels.length; i++){
        const level = app.romEditor.getLevel(i);
        const item = level.htmlItem;
        const dragHandle = item.querySelector('.drag-handle');
        if (dragHandle) {
            dragHandle.style.display = 'none';
        }
    }
}

/**
 * Cancel editing level order
 */
function cancelEditLevels() {
    app.isEditingLevels = false;
    
    // Toggle button display
    document.getElementById('editLevelsBtn').style.display = 'block';
    document.getElementById('editLevelsActionButtons').style.display = 'none';
    
    // Disable level count input
    const levelCountInput = document.getElementById('levelCountInput');
    if (levelCountInput) {
        levelCountInput.value = app.romEditor.getLevelCount();
        levelCountInput.disabled = true;
    }
    
    // If user made changes, restore original order
    if (app.levelsListChanged && app.originalLevelsOrder) {
        app.romEditor.levels = app.originalLevelsOrder.slice();
        
        // Reset all level indices to ensure correct level numbers
        for (let i = 0; i < app.romEditor.levels.length; i++) {
            app.romEditor.levels[i].index = i;
        }
        
        app.originalLevelsOrder = null;
        app.levelsListChanged = false;
        
        // Recreate list to reflect restored order
        app.createLevelList();
        
        // Restore current selected level (if any)
        if (app.currentLevel >= 0 && app.currentLevel < app.romEditor.levels.length) {
            app.selectLevel(app.currentLevel);
        }
        
        app.showMessage('warning', i18n.t("changeLevelOrderCancelWarning"));
    } else {
        // No changes, just hide drag handles
        hideDragHandle();
        app.originalLevelsOrder = null;
    }
}

/**
 */
function checkConsecutiveMoai(mapData, isWideScreen) {
    let rows = Config.GRID_HEIGHT;
    let cols = isWideScreen ? Config.GRID_WIDTH : Config.GRID_WIDTH / 2;
    let consecutiveCount = 0;
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const tileId = mapData[y][x];
            if(tileId === 0xF) {
                consecutiveCount++;
                if (consecutiveCount >= 0xF) {
                    return false;
                }
            }else{
                consecutiveCount = 0;
            }

        }
    }
    return true;
}

/**
 * Save level order
 */
function saveLevels() {
    app.isEditingLevels = false;
    
    // Toggle button display
    document.getElementById('editLevelsBtn').style.display = 'block';
    document.getElementById('editLevelsActionButtons').style.display = 'none';
    hideDragHandle();
    
    // Disable level count input
    const levelCountInput = document.getElementById('levelCountInput');

    if (levelCountInput) {
        levelCountInput.disabled = true;
    }
    
    // If no changes, return directly
    if (!app.levelsListChanged) {
        app.originalLevelsOrder = null;
        return;
    }
    
    // Get current level count, mark excess levels as deleted
    const levelCount = app.romEditor.getLevelCount();
    for (let i = 0; i < app.romEditor.levels.length; i++) {
        if (i >= levelCount) {
            app.romEditor.levels[i].isDeleted = true;
        } else {
            app.romEditor.levels[i].isDeleted = false;
        }
    }
    
    // Recalculate all level ROM addresses (expensive operation, only on save)
    app.romEditor.updateLevelAddresses();
    
    // Mark ROM as modified, needs writing
    app.romEditor.modified = true;
    if (app.writeRomBtn) {
        app.writeRomBtn.disabled = false;
    }
    
    // Clear backup and flags
    app.originalLevelsOrder = null;
    app.levelsListChanged = false;
    
    // Recreate list to update all htmlItem references and level number display
    app.createLevelList();
    
    // Restore current selected level (if in valid range)
    if (app.currentLevel >= 0 && app.currentLevel < levelCount) {
        app.selectLevel(app.currentLevel);
    } else if (app.currentLevel >= levelCount && levelCount > 0) {
        // If current level was deleted, select last valid level
        app.selectLevel(levelCount - 1);
    }else{
        app.selectLevel(0);
    }
    
    app.showMessage('success', i18n.t("changeLevelOrderSuccess"));
}
/**
 * Switch language
 * @param {string} lang - Language code ('zh-CN' or 'en-US')
 */
function switchLanguage(lang) {
    i18n.setLanguage(lang);
    
    // Update language button active state
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const activeBtn = document.querySelector(`.lang-btn[onclick*="${lang}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
}

/**
 * Toggle toolbar mode (drag/drawer)
 */
function toggleToolbarMode() {
    const toolbar = document.getElementById('toolbar');
    const toggleBtn = document.getElementById('toolbarModeToggle');
    const toolbarToggle = document.getElementById('toolbarToggle');
    
    if (!toolbar || !toggleBtn) return;
    
    const isDraggableMode = toolbar.classList.contains('draggable-mode');
    
    if (isDraggableMode) {
        // From drag mode → drawer mode
        toolbar.classList.remove('draggable-mode');
        toolbar.classList.remove('open');
        
        // Clear inline styles from dragging, let CSS take over
        toolbar.style.left = '';
        toolbar.style.top = '';
        toolbar.style.cursor = '';
        
        // Update toggle button
        toggleBtn.textContent = '🔓';
        toggleBtn.title = 'Switch to drag mode';
        
        // Show drawer button and reset its state
        if (toolbarToggle) {
            toolbarToggle.style.display = 'flex';
            toolbarToggle.classList.remove('toolbar-open');
        }
    } else {
        // From drawer mode → drag mode
        toolbar.classList.add('draggable-mode');
        toolbar.classList.add('open');
        
        // Set initial position (top right)
        toolbar.style.left = (window.innerWidth - toolbar.offsetWidth - 20) + 'px';
        toolbar.style.top = '100px';
        
        // Update toggle button
        toggleBtn.textContent = '📌';
        toggleBtn.title = 'Switch to drawer mode';
        
        // Hide drawer button
        if (toolbarToggle) {
            toolbarToggle.style.display = 'none';
        }
    }
}

// Initialize language system on page load
document.addEventListener('DOMContentLoaded', () => {
    // Initialize i18n
    const savedLang = i18n.init();
    
    // Set initial active button
    const activeBtn = document.querySelector(`.lang-btn[onclick*="${savedLang}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    // PC default to drag mode
    initToolbarModeForPC();
});

/**
 * Initialize toolbar to drag mode for PC
 */
function initToolbarModeForPC() {
    const toolbar = document.getElementById('toolbar');
    const toggleBtn = document.getElementById('toolbarModeToggle');
    const toolbarToggle = document.getElementById('toolbarToggle');
    
    if (!toolbar) return;
    
    // Mobile mode: ensure drawer mode, clear all possible residual states
    if (window.innerWidth <= 768) {
        toolbar.classList.remove('draggable-mode');
        toolbar.classList.remove('open');
        toolbar.style.left = '';
        toolbar.style.top = '';
        toolbar.style.cursor = '';
        
        if (toggleBtn) {
            toggleBtn.textContent = '🔓';
            toggleBtn.title = 'Switch to drag mode';
        }
        
        if (toolbarToggle) {
            toolbarToggle.classList.remove('toolbar-open');
        }
        return;
    }
    
    // PC mode: set to drag mode
    toolbar.classList.add('draggable-mode');
    toolbar.classList.add('open');
    
    // Set initial position, delay to ensure toolbar is rendered
    setTimeout(() => {
        toolbar.style.left = (window.innerWidth - toolbar.offsetWidth - 20) + 'px';
        toolbar.style.top = '100px';
    }, 0);
    
    if (toggleBtn) {
        toggleBtn.textContent = '📌';
        toggleBtn.title = 'Switch to drawer mode';
    }
    
    // Hide drawer button
    if (toolbarToggle) {
        toolbarToggle.style.display = 'none';
    }
}

/**
 * Toggle mobile menu
 */
function toggleMobileMenu() {
    const menu = document.getElementById('mobileDropdownMenu');
    if (menu) {
        menu.classList.toggle('active');
    }
}

/**
 * Click elsewhere on page to close menu
 */
document.addEventListener('click', (e) => {
    const menu = document.getElementById('mobileDropdownMenu');
    const menuBtn = document.getElementById('mobileMenuBtn');
    
    if (menu && menuBtn) {
        // If click is not on menu button or menu content, close menu
        if (!menuBtn.contains(e.target) && !menu.contains(e.target)) {
            menu.classList.remove('active');
        }
    }
});

/**
 * Prevent iOS swipe back and rubber band effect
 */
if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
    // Prevent iOS edge swipe back
    let startX = 0;
    let startY = 0;
    let targetElement = null;
    
    document.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        targetElement = e.target;
    }, { passive: true });
    
    document.addEventListener('touchmove', (e) => {
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const deltaX = currentX - startX;
        const deltaY = Math.abs(currentY - startY);
        
        // Check if in level list or sidebar
        const isInLevelList = targetElement && (
            targetElement.closest('.level-list') || 
            targetElement.closest('.sidebar') ||
            targetElement.closest('.level-item')
        );
        
        // If in level list, don't block any swipe
        if (isInLevelList) {
            return;
        }
        
        // If swiping right from left edge (iOS back gesture), and not much vertical movement, block it
        if (startX < 30 && deltaX > 10 && deltaY < 50) {
            e.preventDefault();
        }
        
        // Block top and bottom rubber band effect
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = document.documentElement.clientHeight;
        
        if ((scrollTop <= 0 && currentY > startY) || 
            (scrollTop + clientHeight >= scrollHeight && currentY < startY)) {
            e.preventDefault();
        }
    }, { passive: false });
}
