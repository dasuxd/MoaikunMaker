/**
 * 主应用程序逻辑
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

        this.isShareLevelRan = false;

        this.testMode = false;
        this.romCache = RomCache.getInstance();
        
        // 移动端游戏控制器（延迟初始化）
        this.mobileController = null;
        
        // iOS特殊优化
        this.applyIOSFixes();
        
        this.initEventListeners();
        this.initCache();
       
        //六个按钮
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
     * 应用iOS特殊修复
     */
    applyIOSFixes() {
        const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        if (isIOS) {
            // 为body添加iOS标记类
            document.body.classList.add('ios-device');
            
            // 强制重新计算viewport
            setTimeout(() => {
                window.scrollTo(0, 0);
                // 触发一次resize事件，确保布局正确
                window.dispatchEvent(new Event('resize'));
            }, 100);
        }
    }

    /**
     * 初始化缓存并尝试自动加载
     */
    async initCache() {
        try {
            await this.romCache.init();
            const cachedRom = await this.romCache.loadRom();
            
            if (cachedRom) {
                // 自动加载缓存的 ROM
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
            console.error('初始化缓存失败:', error);
        }
    }

    initParams(){
        // 二进制解码函数：Base64 URL-Safe -> Uint8Array -> Array
        function decodeBase64UrlSafe(str) {
            if (!str) return null;
            
            // 1. 恢复标准 Base64
            let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
            const padLength = (4 - base64.length % 4) % 4;
            base64 += '='.repeat(padLength);
            
            // 2. Base64 解码为二进制字符串
            const binaryString = atob(base64);
            
            // 3. 转为 Uint8Array
            const uint8Array = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
            }
            
            // 4. 转为普通数组
            return Array.from(uint8Array);
        }
        
        const urlParams = new URLSearchParams(window.location.search);
        const mapDataParam = urlParams.get("mapData");
        const enemyDataParam = urlParams.get("enemyData");
        
        // 检查参数是否存在
        if (!mapDataParam || !enemyDataParam) {
            console.log("URL 中没有关卡数据参数");
            return;
        }
        
        try {
            const mapData = decodeBase64UrlSafe(mapDataParam);
            const enemyData = decodeBase64UrlSafe(enemyDataParam);
            
            // 验证数据
            if (!Array.isArray(mapData) || !Array.isArray(enemyData)) {
                console.error("解析的数据格式不正确");
                return;
            }
            
            console.log('✅ 解析后的地图数据:', mapData);
            console.log('✅ 解析后的敌人数据:', enemyData);
            
            const data = {
                mapData: mapData,
                monsterData: enemyData,
            };
            
            // 检查 ROM 是否加载
            if (this.romEditor.romData == null) {
                console.log("数据还未就绪，等待 ROM 加载...");
                
                // 延迟执行，等待 ROM 加载
                const checkInterval = setInterval(() => {
                    if (this.romEditor.romData != null) {
                        clearInterval(checkInterval);
                        this.loadSharedLevel(data);
                    }
                }, 100);
                return;
            }
            
            // ROM 已加载，直接加载关卡
            this.loadSharedLevel(data);
            
        } catch (error) {
            console.error('❌ 解析 URL 参数失败:', error);
            this.showMessage('error', i18n.t('loadShareLevelError'));
        }
    }
    
    /**
     * 加载分享的关卡
     */
    loadSharedLevel(data) {
        if(this.changeMode()){
            return;
        }
        const tmpRomData = this.createTmpRomData(data);
        // const editorSection = document.getElementById('editorSection');
        // editorSection.classList.add('active');
        

        // 创建模拟器并加载临时 ROM
        if (!this.emulator) {
            this.emulator = new NesEmulator('levelCanvas');
        }
        this.isShareLevelRan = true;
        this.levelEditor.testMode = true;
        this.emulator.loadROM(tmpRomData);
        this.emulator.start();
        this.showMessage('success', i18n.t('loadSharedLevelSuccess'));
        
    }
    
    /**
     * 初始化事件监听器
     */
    initEventListeners() {
        document.getElementById('fileInput').addEventListener('change', 
            (e) => this.handleFileSelect(e));

        // 初始化移动控制器

        
        // 关卡列表抽屉切换
        const sidebarToggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebar');
        if (sidebarToggle && sidebar) {
            sidebarToggle.addEventListener('click', () => {
                sidebar.classList.toggle('open');
                sidebarToggle.classList.toggle('sidebar-open');
            });
        }

        // 工具栏抽屉切换
        const toolbarToggle = document.getElementById('toolbarToggle');
        const toolbar = document.querySelector('.toolbar');
        if (toolbarToggle && toolbar) {
            toolbarToggle.addEventListener('click', () => {
                toolbar.classList.toggle('open');
                toolbarToggle.classList.toggle('toolbar-open');
            });
        }
        
        // 关卡总数输入框
        const levelCountInput = document.getElementById('levelCountInput');
        if (levelCountInput) {
            // 使用 input 事件实现实时监听
            levelCountInput.addEventListener('input', (e) => {
                const count = parseInt(e.target.value);
                // 只有输入完整有效数字时才更新
                if (!isNaN(count) && count >= 1 && count <= 255) {
                    this.romEditor.setLevelCount(count);
                    this.levelsListChanged = true;
                }
            });
            
            // 失去焦点时验证并修正无效值
            levelCountInput.addEventListener('blur', (e) => {
                const count = parseInt(e.target.value);
                if (isNaN(count) || count < 1 || count > 255) {
                    this.showMessage('error', i18n.t('invalidLevelCountMessage'));
                    e.target.value = this.romEditor.getLevelCount();
                }
            });
            
            // 防止输入非数字字符
            levelCountInput.addEventListener('keypress', (e) => {
                if (e.key && !/[0-9]/.test(e.key)) {
                    e.preventDefault();
                }
            });
        }
        
        // 清除缓存按钮
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
                
                // 更新按钮状态
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
     * 处理文件选择
     */
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.fileName = file.name;
        const reader = new FileReader();
        
        reader.onload = async (e) => {
            this.loadRomData(e.target.result, file.name, false);
            
            // 保存到缓存
            try {
                await this.romCache.saveRom(e.target.result, file.name);
            } catch (error) {
                console.error('保存到缓存失败:', error);
            }
        };
        
        reader.readAsArrayBuffer(file);
    }
    
    /**
     * 加载 ROM 数据（统一处理文件上传和缓存加载）
     * @param {ArrayBuffer} data - ROM 数据
     * @param {string} fileName - 文件名
     * @param {boolean} fromCache - 是否来自缓存
     */
    loadRomData(data, fileName, fromCache = false) {
        this.fileName = fileName;
        this.romEditor.loadROM(data);
        
        // 隐藏欢迎提示页面
        this.hideWelcomeOverlay();
        
        // 加载图片资源
        ResourceManager.getInstance().initResources(this.romEditor.romData, this.romEditor.palettes);
        this.levelEditor.createButtons();
        levelCountInput.value = this.romEditor.getLevelCount();
        this.createLevelList();
        this.updateMemoryOverview();
        // const editorSection = document.getElementById('editorSection');
        // editorSection.classList.remove('active');
        if (!fromCache) {
            //this.showMessage('success', `文件加载成功: ${fileName} (${this.romEditor.romData.length} 字节)`);
            this.showMessage('success', i18n.t("loadFileSuccess",{fileNameStr: fileName, length: this.romEditor.romData.length}));
        }
        
        // 更新按钮显示文件名
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

        if(!this.isShareLevelRan){
            this.initParams();
        }
    }
    
    /**
     * 隐藏欢迎提示页面
     */
    hideWelcomeOverlay() {
        const welcomeOverlay = document.getElementById('welcomeOverlay');
        if (welcomeOverlay) {
            welcomeOverlay.classList.add('hidden');
        }
    }

    //创建关卡列表
    createLevelList(){
        const listElement = document.getElementById('levelList');
        //清空列表
        listElement.innerHTML = '';
        
        // 销毁旧的 Sortable 实例，避免重复绑定导致移动端无法二次拖拽
        if (this.sortable) {
            this.sortable.destroy();
            this.sortable = null;
        }

        const levels = this.romEditor.getAllLevels();
        
        // 显示侧边栏切换按钮和主布局
        document.getElementById('mainLayout').style.display = 'flex';
        document.getElementById('sidebarToggle').style.display = 'flex';
        document.getElementById('toolbarToggle').style.display = 'flex';
        
        // 禁用关卡总数输入框（仅在编辑模式下启用）
        const levelCountInput = document.getElementById('levelCountInput');
        if (levelCountInput) {
            //levelCountInput.value = this.romEditor.getLevelCount();
            levelCountInput.disabled = true;
        }

        if(levelCountInput.value > levels.length){
            //创建出多余的关卡
            const levelCountInputValue = parseInt(levelCountInput.value, 10);
            this.romEditor.setLevelCount(levelCountInputValue);
            for(let i = levels.length; i < levelCountInputValue; i++){
                const newLevel = new Level(i);
                levels.push(newLevel);
            }
        }

        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            // 跳过已删除的关卡
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
            // 移动端优化
            forceFallback: false,
            fallbackTolerance: 5,
            delay: 100,
            delayOnTouchOnly: true,
            touchStartThreshold: 5,
            // 防止滚动冲突
            preventOnFilter: false,
            onEnd: function(evt) {
                // 如果位置没有变化，直接返回
                if (evt.oldIndex === evt.newIndex) {
                    return;
                }
                
                // 更新 levels 数组顺序
                const [movedLevel] = app.romEditor.levels.splice(evt.oldIndex, 1);
                app.romEditor.levels.splice(evt.newIndex, 0, movedLevel);
                
                // 更新所有关卡的 index 和 dataset.index
                for (let i = 0; i < app.romEditor.levels.length; i++) {
                    app.romEditor.levels[i].index = i;
                    if (app.romEditor.levels[i].htmlItem) {
                        app.romEditor.levels[i].htmlItem.dataset.index = i;
                    }
                }
                
                // 标记顺序已改变
                app.levelsListChanged = true;
                
                // 更新当前选中的关卡索引
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
        
        // 创建拖拽手柄
        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle';
        dragHandle.textContent = '⋮⋮';
        dragHandle.style.display = 'none'; // 默认隐藏
    
        item.appendChild(dragHandle);

        // 创建可点击的内容区域
        const content = document.createElement('div');
        content.className = 'level-content';
        
        // 触摸位置追踪，防止滑动时误触发点击
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
            
            // 计算滑动距离
            const deltaX = Math.abs(touchEndX - touchStartX);
            const deltaY = Math.abs(touchEndY - touchStartY);
            const deltaTime = touchEndTime - touchStartTime;
            
            // 只有滑动距离小于10px且时间小于300ms才认为是点击
            if (deltaX < 10 && deltaY < 10 && deltaTime < 300) {
                e.preventDefault();
                e.stopPropagation();
                this.selectLevel(index);
            }
        }, { passive: false });
        
        // 桌面端保留click事件
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
     * 选择关卡进行编辑
     */
    selectLevel(index) {
        if(index === -1){
            app.showMessage('warning', "");
            //app.showMessage('warning', i18n.t("rom"));
            return;
        }
        this.currentLevel = index;
        const level = this.romEditor.getLevel(index);
        
        // 更新选中状态
        const items = document.querySelectorAll('.level-item');
        items.forEach((item, i) => {
            item.classList.toggle('active', i === index);
        });

        // 显示编辑器
        // const editorSection = document.getElementById('editorSection');
        // editorSection.classList.add('active');
        //editorSection.scrollIntoView({ behavior: 'smooth' });

        // 更新编辑器内容
        // document.getElementById('editorTitle').textContent = 
        //     `编辑关卡 ${level.getLevelNumber()}`;
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
        
        // 加载数据到可视化编辑器
        this.loadLevelToVisualEditor(level);

        this.testLevelBtn.disabled = false;;
        this.testBtn.disabled = false;;
        
        // 显示/隐藏可视化编辑按钮
        //document.getElementById('visualEditBtn').style.display = 'inline-block';
    }

    addLevel(){
        //新增关卡
        console.log("TODO : Add Level");
    }
    
    /**
     * 将关卡数据加载到可视化编辑器
     */
    loadLevelToVisualEditor(level) {
        try {
            // 获取关卡数据（Level 类使用 data 和 monsterData 属性）
            const mapData = level.data;
            const monsterData = level.monsterData;
            
            // 转换为可视化编辑器格式
            const editorData = DataConverter.fromROMtoEditor(mapData, monsterData);
            
            // 加载到可视化编辑器
            if (this.levelEditor) {
                this.levelEditor.loadFromData(editorData, this.currentLevel);
            }
        } catch (error) {
            console.error('Failed to load level to visual editor:', error);
        }
    }

    // 切换信息栏显示状态
    toggleInfoItems(showOperation) {
        const operationItem = document.getElementById('operationInfoItem');
        const toolItem = document.getElementById('currentToolInfoItem');
        const mouseItem = document.getElementById('mousePositionInfoItem');
        
        if (showOperation) {
            // 测试模式：显示操作信息，隐藏工具和鼠标信息
            operationItem?.classList.add('active');
            toolItem?.classList.remove('active');
            mouseItem?.classList.remove('active');
        } else {
            // 编辑模式：隐藏操作信息，显示工具和鼠标信息
            operationItem?.classList.remove('active');
            toolItem?.classList.add('active');
            mouseItem?.classList.add('active');
        }
    }

    // 切换模式，如果是测试模式则退出
    changeMode(){
        this.levelEditor.testMode = !this.testMode
        if(this.testMode){
            this.testMode = false;
            this.emulator.stop();
            this.levelEditor.render();
            this.toggleInfoItems(false); // 切换到编辑模式显示
            
            // 移除测试模式类，恢复正常大小
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
            
            // 移除body的test-mode类
            document.body.classList.remove('test-mode');
            
            // 隐藏移动控制面板
            if (this.mobileController) {
                this.mobileController.hide();
            }
            
            // 恢复按钮状态
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
            this.toggleInfoItems(true); // 切换到测试模式显示
        }
        this.testMode = true;
        return false;
    }
    
    // 结束模拟器
    stopEmulator() {
        if (!this.testMode) {
            this.showMessage('warning', i18n.t("emulatorNotRunningWarning"));
            return;
        }
        
        // 移除测试模式类，恢复正常大小
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
        
        // 移除body的test-mode类
        document.body.classList.remove('test-mode');
        
        // 隐藏移动控制面板
        if (this.mobileController) {
            this.mobileController.hide();
        }
        
        this.changeMode();
        this.showMessage('info', i18n.t("emulatorStopInfo"));
    }

    //分享当前关卡
    shareLevel(){
        if(this.currentLevel === -1){
            this.showMessage('warning', i18n.t("pleaseSelectLevelFirstWarning"));
            return;
        }
        
        // 二进制编码函数：Array -> Uint8Array -> Base64 URL-Safe
        function encodeDataBinary(dataArray) {
            // 将数字数组转为 Uint8Array
            const uint8Array = new Uint8Array(dataArray);
            
            // 转为二进制字符串
            let binaryString = '';
            for (let i = 0; i < uint8Array.length; i++) {
                binaryString += String.fromCharCode(uint8Array[i]);
            }
            
            // Base64 编码（URL 安全）
            return btoa(binaryString)
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
        }
        
        try {
            const tmpEditorData = this.getLevelEditorData();
            const levelRomData = DataConverter.fromLevelEditorToROMData(tmpEditorData, this.levelEditor.isWideScreen);

            // 获取当前页面完整 URL
            const url = new URL(window.location.href);
            
            // 清除可能存在的其他参数，避免冲突
            url.searchParams.delete('level');

            // 设置参数（使用二进制编码，更短更高效）
            url.searchParams.set("mapData", encodeDataBinary(levelRomData.mapData));
            url.searchParams.set("enemyData", encodeDataBinary(levelRomData.monsterData));

            const shareUrl = url.toString();

            // 复制到剪贴板
            navigator.clipboard.writeText(shareUrl)
                .then(() => {
                    this.showMessage('success', i18n.t("copyShareLevelLinkSuccess"));
                    console.log('Share URL:', shareUrl);
                    console.log('URL length:', shareUrl.length);
                })
                .catch(err => {
                    console.error("复制失败:", err);
                    prompt("复制失败，请手动复制以下链接：", shareUrl);
                });
        } catch (error) {
           // console.error('生成分享链接失败:', error);
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
        
        // 深度拷贝 romEditor.romData (Uint8Array)
        const romData = new Uint8Array(this.romEditor.romData);
        // 将临时关卡写入拷贝的 ROM 数据
        RomEditor.writeToROM(romData, tmpLevels, 1);
        return romData;
    }

    // 测试当前关卡
    async testLevel(){
        if(this.changeMode()){
            return;
        }

        //构建临时关卡，
        // 新建一个 romData，然后把当前关卡当作第一关塞进去。
        // 修改关卡总数为 1.
        const tmpEditorData = this.getLevelEditorData();
        const levelRomData = DataConverter.fromLevelEditorToROMData(tmpEditorData, this.levelEditor.isWideScreen);
        const romData = this.createTmpRomData(levelRomData);

        
        // 创建模拟器并加载临时 ROM
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

    // 添加测试 ROM 的方法
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
        
        // 从可视化编辑器获取数据
        if (!this.levelEditor) {
            this.showMessage('error', i18n.t("editorNotInitError"));
            return;
        }
        
        // 获取编辑器数据
        let bgId = parseInt(this.levelEditor.currentBgId) +  (this.levelEditor.isWideScreen ? 16 : 0);
        
        const editorData = {
            background: bgId,
            map: this.levelEditor.mapData,
            player: this.levelEditor.playerPos,
            door: this.levelEditor.doorPos,
            enemies: this.levelEditor.enemies
        };

        return editorData;
    }

    /**
     * 保存当前关卡
     */
    saveLevel() {
        const levelEditorData = this.getLevelEditorData();

        try {
            // 转换为ROM格式
            const romData = DataConverter.fromLevelEditorToROMData(levelEditorData, this.levelEditor.isWideScreen);
            
            console.log('转换后的ROM数据:', {
                mapDataLength: romData.mapData.length,
                monsterDataLength: romData.monsterData.length,
                monsterData: romData.monsterData
            });
            

            // 保存到ROM
            const level = this.romEditor.getLevel(this.currentLevel);
            const result = level.saveMapData(romData.mapData);
            if (!result) {
                this.showMessage('error', i18n.t("saveMapFailedError"));
                return;
            }
            
            // 保存怪物数据
            const monsterResult = level.saveMonsterData(romData.monsterData);
            if (!monsterResult.success) {
                //this.showMessage('error', '怪物数据错误: ' + monsterResult.error);
                this.showMessage('error', i18n.t("monsterDataError",{error:monsterResult.error}));
                return;
            }
            
            //document.getElementById('downloadBtn').disabled = false;
            //this.showMessage('success', `关卡 ${this.currentLevel + 1} 保存成功！地图和怪物数据已更新。`);
            this.showMessage('success', i18n.t("saveMapSuccess", {currentLevel: this.currentLevel + 1}));
            
            // 刷新显示
            this.selectLevel(this.currentLevel);
            this.updateMemoryOverview();
            this.writeRomBtn.disabled = false;
            level.modified = true;
            this.saveBtn.disabled = true;
        } catch (error) {
            //console.error('保存关卡失败:', error);
            //this.showMessage('error', '保存失败: ' + error.message);
            this.showMessage('error', i18n.t("saveLevelFailedError",{error: error.message}));
        }
    }

    /**
     * 写入ROM（将所有修改写入ROM数据）
     */
    writeToROM() {
        try {
            this.romEditor.recalculateAddresses(this.romEditor.levels);
            RomEditor.writeToROM(this.romEditor.romData, this.romEditor.levels, this.romEditor.levelCount);
            this.romEditor.modified = false;
            this.showMessage('success', i18n.t("write2RomSuccess"));
            //console.log('ROM数据写入成功');
        } catch (error) {
            //console.error('写入ROM失败:', error);
            this.showMessage('error', i18n.t("write2RomFiledError", {error: error.message}));
        }
    }
    /**
     * 下载修改后的 ROM
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
     * 显示消息
     */
    showMessage(type, text) {
        console.log(`${type.toUpperCase()}: ${text}`);
        
        // 获取或创建消息容器
        let container = document.getElementById('messageContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'messageContainer';
            container.className = 'message-container';
            document.body.appendChild(container);
        }
        
        // 创建消息元素
        const message = document.createElement('div');
        message.className = `message-toast ${type}`;
        
        // 添加图标
        const icon = document.createElement('div');
        icon.className = 'message-toast-icon';
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        icon.textContent = icons[type] || '🔔';
        
        // 添加文本
        const textElement = document.createElement('div');
        textElement.className = 'message-toast-text';
        textElement.textContent = text;
        
        message.appendChild(icon);
        message.appendChild(textElement);
        container.appendChild(message);
        
        // 根据屏幕宽度决定显示时长：移动端2秒，桌面端5秒
        const isMobile = window.matchMedia('(pointer: coarse)').matches;
        const displayTime = isMobile ? 2000 : 5000;
        
        // 显示后自动隐藏
        setTimeout(() => {
            message.classList.add('hiding');
            setTimeout(() => {
                message.remove();
                // 如果容器为空，移除容器
                if (container.children.length === 0) {
                    container.remove();
                }
            }, 300); // 等待退出动画完成
        }, displayTime);
    }

    /**
     * 隐藏消息
     */
    hideMessage(type) {
        // const msgElement = document.getElementById(type + 'Msg');
        // msgElement.classList.remove('show');
    }

    /**
     * 更新内存使用概览
     */
    updateMemoryOverview() {
        const levels = this.romEditor.getAllLevels();
        if (levels.length === 0) return;

        const firstLevelStart = levels[0].romAddress;
        const maxSize = Config.DATA_START_MAX - firstLevelStart;
        const usedSize = this.romEditor.calculateTotalSize();
        //const freeSize = maxSize - usedSize;
        const percentage = ((usedSize / maxSize) * 100).toFixed(1);

        // 更新进度条
        document.getElementById('memoryBarFill').style.width = `${percentage}%`;
        document.getElementById('memoryBarText').textContent = 
            `${usedSize} / ${maxSize} Byte (${percentage}%)`;

        // 生成分段显示
        this.generateMemorySegments(levels, maxSize);

        document.getElementById('memoryOverview').style.display = 'block';
    }

    /**
     * 生成内存分段可视化
     */
    generateMemorySegments(levels, maxSize) {
        const container = document.getElementById('memorySegments');
        container.innerHTML = '';

        // 使用不同的颜色
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
            tooltip.textContent = `关卡${level.getLevelNumber()}: ${level.getTotalSize()} Byte`;
            segment.appendChild(tooltip);

            container.appendChild(segment);
        }
    }
    
    /**
     * 更新占位符
     */
    updatePlaceholder() {
        // 移除所有占位符
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
     * 拖拽经过
     */
    handleDragOver(e) {
        if (e.preventDefault) {
            e.preventDefault();
        }
        e.dataTransfer.dropEffect = 'move';
        e.currentTarget.classList.add('drag-over');
        return false;
    }

    /**
     * 放下
     */
    handleDrop(e, targetIndex) {
        if (e.stopPropagation) {
            e.stopPropagation();
        }
        e.preventDefault();

        e.currentTarget.classList.remove('drag-over');

        if (this.draggedIndex === targetIndex) {
            return false;
        }

        // 重新排序关卡
        const result = this.romEditor.reorderLevels(this.draggedIndex, targetIndex);
        
        if (result.success) {
            // 标记被拖拽的关卡
            this.romEditor.getLevel(targetIndex).markAsDragged();
            
            // 更新当前选中的关卡索引
            if (this.currentLevel === this.draggedIndex) {
                this.currentLevel = targetIndex;
            } else if (this.draggedIndex < this.currentLevel && targetIndex >= this.currentLevel) {
                this.currentLevel--;
            } else if (this.draggedIndex > this.currentLevel && targetIndex <= this.currentLevel) {
                this.currentLevel++;
            }

            if (this.currentLevel >= 0) {
                this.selectLevel(this.currentLevel);
            }
            //this.updateMemoryOverview();
            
            //document.getElementById('downloadBtn').disabled = false;
            //this.showMessage('success', `关卡已移动：${this.draggedIndex + 1} → ${targetIndex + 1}`);
            this.showMessage('success', i18n.t("levelReorderSuccess", {draggedIndex: this.draggedIndex + 1, targetIndex: targetIndex + 1}));
        } else {
            this.showMessage('error',  i18n.t("levelReorderError"));
        }

        return false;
    }

    /**
     * 验证怪物数据格式
     */
    validateMonsterData() {
        const monsterInput = document.getElementById('monsterData').value.trim();
        
        if (!monsterInput) {
            return;
        }

        const hexBytes = monsterInput.split(/\s+/).filter(s => s.length > 0);
        
        // 验证十六进制格式
        for (let hex of hexBytes) {
            if (!/^[0-9A-Fa-f]{1,2}$/.test(hex)) {
                return;
            }
        }

        const bytes = hexBytes.map(h => parseInt(h, 16));
        const firstByte = bytes[0];
        
        // 简单验证
        if (firstByte === 0x01) {
            if (bytes.length !== 1) {
                // 警告但不阻止
            }
        } else if (firstByte !== bytes.length) {
            // 警告但不阻止
        }
    }

    vibrate(ms = 200){
        // 先檢查是否存在這個方法
        // I hate webKit
        if (!("vibrate" in navigator)) {
            console.log("此裝置/瀏覽器不支援震動");
            return;
        }

        try {
            navigator.vibrate(ms);
        } catch (err) {
            console.log("震動被阻擋", err);
        }
    }
}

// 全局应用实例
let app;

// 页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    app = new App();
});

// 全局函数
function testROM() {
    app.testROM();
}

// 全局函数
async function testLevel() {
    await app.testLevel();
}

// 全局函数
function stopEmulator() {
    app.stopEmulator();
}

// 全局函数供 HTML 调用
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
 * 开始编辑关卡顺序
 */
function startEditLevels() {
    app.isEditingLevels = true;
    
    // 备份当前顺序（浅拷贝数组，Level 对象保持引用）
    app.originalLevelsOrder = app.romEditor.levels.slice();
    app.levelsListChanged = false;
    
    // 切换按钮显示
    document.getElementById('editLevelsBtn').style.display = 'none';
    document.getElementById('editLevelsActionButtons').style.display = 'flex';
    
    // 启用关卡总数输入框
    const levelCountInput = document.getElementById('levelCountInput');
    if (levelCountInput) {
        levelCountInput.disabled = false;
    }

    //修改 item 为拖拽样式
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
    // 隐藏 dragHandle
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
 * 取消编辑关卡顺序
 */
function cancelEditLevels() {
    app.isEditingLevels = false;
    
    // 切换按钮显示
    document.getElementById('editLevelsBtn').style.display = 'block';
    document.getElementById('editLevelsActionButtons').style.display = 'none';
    
    // 禁用关卡总数输入框
    const levelCountInput = document.getElementById('levelCountInput');
    if (levelCountInput) {
        levelCountInput.value = app.romEditor.getLevelCount();
        levelCountInput.disabled = true;
    }
    
    // 如果用户做了修改，恢复原始顺序
    if (app.levelsListChanged && app.originalLevelsOrder) {
        app.romEditor.levels = app.originalLevelsOrder.slice();
        
        // 重新设置所有关卡的 index，确保关卡编号正确
        for (let i = 0; i < app.romEditor.levels.length; i++) {
            app.romEditor.levels[i].index = i;
        }
        
        app.originalLevelsOrder = null;
        app.levelsListChanged = false;
        
        // 重新创建列表以反映恢复的顺序
        app.createLevelList();
        
        // 恢复当前选中关卡（如果有）
        if (app.currentLevel >= 0 && app.currentLevel < app.romEditor.levels.length) {
            app.selectLevel(app.currentLevel);
        }
        
        app.showMessage('warning', i18n.t("changeLevelOrderCancelWarning"));
    } else {
        // 没有修改，只需隐藏拖拽手柄
        hideDragHandle();
        app.originalLevelsOrder = null;
    }
}

/**
 * 保存关卡顺序
 */
function saveLevels() {
    app.isEditingLevels = false;
    
    // 切换按钮显示
    document.getElementById('editLevelsBtn').style.display = 'block';
    document.getElementById('editLevelsActionButtons').style.display = 'none';
    hideDragHandle();
    
    // 禁用关卡总数输入框
    const levelCountInput = document.getElementById('levelCountInput');

    if (levelCountInput) {
        levelCountInput.disabled = true;
    }
    
    // 如果没有修改，直接返回
    if (!app.levelsListChanged) {
        app.originalLevelsOrder = null;
        return;
    }
    
    // 获取当前关卡总数，标记超出部分的关卡为已删除
    const levelCount = app.romEditor.getLevelCount();
    for (let i = 0; i < app.romEditor.levels.length; i++) {
        if (i >= levelCount) {
            app.romEditor.levels[i].isDeleted = true;
        } else {
            app.romEditor.levels[i].isDeleted = false;
        }
    }
    
    // 重新计算所有关卡的 ROM 地址（昂贵操作，只在保存时执行）
    app.romEditor.updateLevelAddresses();
    
    // 标记 ROM 已修改，需要写入
    app.romEditor.modified = true;
    if (app.writeRomBtn) {
        app.writeRomBtn.disabled = false;
    }
    
    // 清理备份和标志
    app.originalLevelsOrder = null;
    app.levelsListChanged = false;
    
    // 重新创建列表以更新所有 htmlItem 引用和关卡编号显示
    app.createLevelList();
    
    // 恢复当前选中关卡（如果在有效范围内）
    if (app.currentLevel >= 0 && app.currentLevel < levelCount) {
        app.selectLevel(app.currentLevel);
    } else if (app.currentLevel >= levelCount && levelCount > 0) {
        // 如果当前关卡被删除，选中最后一个有效关卡
        app.selectLevel(levelCount - 1);
    }else{
        app.selectLevel(0);
    }
    
    app.showMessage('success', i18n.t("changeLevelOrderSuccess"));
}
/**
 * 切换语言
 * @param {string} lang - 语言代码 ('zh-CN' 或 'en-US')
 */
function switchLanguage(lang) {
    i18n.setLanguage(lang);
    
    // 更新语言按钮的激活状态
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const activeBtn = document.querySelector(`.lang-btn[onclick*="${lang}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
}

// 页面加载时初始化语言系统
document.addEventListener('DOMContentLoaded', () => {
    // 初始化 i18n
    const savedLang = i18n.init();
    
    // 设置初始激活按钮
    const activeBtn = document.querySelector(`.lang-btn[onclick*="${savedLang}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
});

/**
 * 切换移动端菜单
 */
function toggleMobileMenu() {
    const menu = document.getElementById('mobileDropdownMenu');
    if (menu) {
        menu.classList.toggle('active');
    }
}

/**
 * 点击页面其他地方关闭菜单
 */
document.addEventListener('click', (e) => {
    const menu = document.getElementById('mobileDropdownMenu');
    const menuBtn = document.getElementById('mobileMenuBtn');
    
    if (menu && menuBtn) {
        // 如果点击的不是菜单按钮也不是菜单内容，则关闭菜单
        if (!menuBtn.contains(e.target) && !menu.contains(e.target)) {
            menu.classList.remove('active');
        }
    }
});

/**
 * 防止iOS滑动返回和橡皮筋效果
 */
if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
    // 防止iOS边缘滑动返回
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
        
        // 检查是否在关卡列表或sidebar内
        const isInLevelList = targetElement && (
            targetElement.closest('.level-list') || 
            targetElement.closest('.sidebar') ||
            targetElement.closest('.level-item')
        );
        
        // 如果在关卡列表内，不阻止任何滑动
        if (isInLevelList) {
            return;
        }
        
        // 如果是从左边缘向右滑动（iOS返回手势），且垂直移动不多，则阻止
        if (startX < 30 && deltaX > 10 && deltaY < 50) {
            e.preventDefault();
        }
        
        // 阻止顶部和底部的橡皮筋效果
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = document.documentElement.clientHeight;
        
        if ((scrollTop <= 0 && currentY > startY) || 
            (scrollTop + clientHeight >= scrollHeight && currentY < startY)) {
            e.preventDefault();
        }
    }, { passive: false });
}
