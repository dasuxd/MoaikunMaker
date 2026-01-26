/**
 * Moai-kun 关卡地图编辑器
 */
class LevelEditor {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        
        // 地图数据 (16x14)
        this.mapData = Array(Config.GRID_HEIGHT).fill(null).map(() => Array(Config.GRID_WIDTH).fill(0));
        
        // 特殊对象位置
        this.playerPos = null;  // {x, y}
        this.doorPos = null;    // {x, y}
        
        // 敌人列表 [{id, x, y}, ...]
        this.enemies = [];
        
        // 是否为宽屏
        this.isWideScreen = false;
        this.isBugScreen = false;

        // 当前背景ID（使用私有变量配合getter/setter实现双向绑定）
        this.currentBgId = -1;
        
        // 当前选中的工具
        this.currentTool = null;
        this.currentTileId = null;
        this.currentEnemyId = null;
        
        // 鼠标位置
        this.mouseGridPos = null;
        
        // 鼠标按下状态（用于拖拽绘制）
        this.isMouseDown = false;
        this.isLeftButtonDown = false;  // 左键按下状态
        this.isRightButtonDown = false; // 右键按下状态

        // 按钮资源
        this.tileBtns = [];
        this.enemyBtns = [];
        this.playerBtn = null;
        this.doorBtn = null;
        this.eraserBtn = null;
        
        // 图片资源
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
    }
    
    /**
     * isWideScreen 的 getter
     */
    get isWideScreen() {
        return this._isWideScreen;
    }
    
    /**
     * isWideScreen 的 setter（自动同步复选框）
     */
    set isWideScreen(value) {
        this._isWideScreen = value;
        // 同步更新复选框的状态
        const wideScreenCheckbox = document.getElementById('wideScreenCheckbox');
        if (wideScreenCheckbox && wideScreenCheckbox.checked !== value) {
            wideScreenCheckbox.checked = value;
        }
    }
    
    /**
     * 从数据对象加载关卡
     * @param {Object} data - {background, map, player, door, enemies}
     * @param {number} levelIndex - 关卡索引（可选）
     */
    loadFromData(data, levelIndex = null) {
        try {
            // 设置背景ID
            if (data.background !== undefined) {
                this.isWideScreen = data.isWideScreen;
                this.isBugScreen = data.isBugScreen;
                this.currentBgId = data.background;
            }
            
            // 设置地图数据 (16x14)
            if (data.map && data.map.length === Config.GRID_HEIGHT) {
                this.mapData = data.map.map(row => [...row]);
            }
            
            // 设置玩家位置
            if (data.player) {
                this.playerPos = { x: data.player.x, y: data.player.y };
            } else {
                this.playerPos = null;
            }
            
            // 设置门位置
            if (data.door) {
                this.doorPos = { x: data.door.x, y: data.door.y };
            } else {
                this.doorPos = null;
            }
            
            // 设置敌人列表
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
            // 更新显示
            this.render();
            
            // 显示提示信息
            if (levelIndex !== null) {
                console.log(`已加载关卡 ${levelIndex + 1} 的数据`);
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
     * 切换场景背景
     * @param {string} bgId - 背景ID（如 '03'）
     */
    changeBgId(bgId) {
        console.log('切换场景到:', bgId);
        this.currentBgId = bgId;  // 使用setter，会自动同步下拉框
        this.resetImages();
        this.updateButtonImages();
        this.saveStatusEnabled();
    }
    
    /**
     * 创建tile选择按钮
     */
    updateButtonImages() {
        // 更新 tile 按钮
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
        
        // 重新渲染画布
        this.render();
    }

    /**
     * 更新所有按钮的图片（当场景切换时）
     */
    updateButtonImage(btn, imgName) {
        const img = btn.querySelector('img');
        const prohibitIcon = btn.querySelector('div');
        const nameId = imgName;
        if (img) { 
            const imgResource = ResourceManager.getInstance().getResource(this.currentBgId, nameId);
            if (imgResource instanceof HTMLImageElement) {
                // 如果返回的是 Image 对象，使用其 src
                img.src = imgResource.src;
            } else if (typeof imgResource === 'string') {
                // 如果返回的是字符串 URL，直接使用
                img.src = imgResource;
            }
            img.style.display = 'block';
            prohibitIcon.style.display = 'none';
        } else if (prohibitIcon) {
            // 如果之前是禁止符号，尝试重新加载图片
            const imgResource = ResourceManager.getInstance().getResource(this.currentBgId, nameId);
            if (imgResource instanceof HTMLImageElement) {
                // 如果返回的是 Image 对象，克隆它
                const newImg = imgResource.cloneNode(true);
                newImg.alt = `${imgName}`;
                prohibitIcon.replaceWith(newImg);
            } else if (typeof imgResource === 'string') {
                // 如果返回的是字符串 URL
                const newImg = document.createElement('img');
                newImg.src = imgResource;
                newImg.alt = `${imgName}`;
                newImg.onerror = () => {
                    // 如果加载失败，保持禁止符号
                };
                newImg.onload = () => {
                    // 加载成功，替换禁止符号
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
        
        // 固定按钮尺寸
        btn.style.width = '60px';
        btn.style.height = '85px';
        btn.style.minWidth = '60px';
        btn.style.minHeight = '85px';
        
        let imgName = type;
        if(id !== null){
            imgName += `_${id}`;
        }
        btn.dataset.imgName = imgName;

        //const imgSrc = ResourceManager.getInstance().getResource(this.currentBgId, imgName);
        const imgSrc = '';

        const img = document.createElement('img');
        
        if(imgSrc !== null){
            img.src = imgSrc;
        }else{
            img.src = '';
        }
        
        img.alt = alt;
        // 不压缩图片，使用原始尺寸
        //根据id判断尺寸
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
            // 创建禁止符号容器
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
            
            // 替换img为禁止符号
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
            // 创建禁止符号容器
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
            // 替换img为禁止符号
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
        // 先移除所有button
        const specialContainer = document.getElementById('specialButtons');
        const tileContainer = document.getElementById('tileButtons');
        const enemyContainer = document.getElementById('enemyButtons');
        
        if (specialContainer) specialContainer.innerHTML = '';
        if (tileContainer) tileContainer.innerHTML = '';
        if (enemyContainer) enemyContainer.innerHTML = '';
        
        // 清空按钮数组
        this.tileBtns = [];
        this.enemyBtns = [];
        this.playerBtn = null;
        this.doorBtn = null;
        
        this.createSpiceTileButtons();
        this.createTileButtons();
        this.createEnemyButtons();
    }

    createSpiceTileButtons() {
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
        // 添加tile按钮
        for (let i = 1; i <= 15; i++) {
            const btn = this.createButton("tile", container, `Tile ${i}`, i);
            this.tileBtns.push(btn);
        }
    }
    
    /**
     * 创建敌人选择按钮
     */
    createEnemyButtons() {
        const container = document.getElementById('enemyButtons');
        for (let i = 1; i <= 11; i++) {
            const btn = this.createButton("enemy", container, `Enemy ${i}`, i);
            this.enemyBtns.push(btn);
        }
    }
    
    /**
     * 设置工具栏选项卡
     */
    setupToolbarTabs() {
        const tabs = document.querySelectorAll('.tool-tab');
        const contents = document.querySelectorAll('.tool-tab-content');
        
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                
                // 移除所有active类
                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));
                
                // 添加active类到当前选项卡
                tab.classList.add('active');
                const targetContent = document.getElementById(tabName + 'Tab');
                if (targetContent) {
                    targetContent.classList.add('active');
                }
            });
        });
    }
    
    /**
     * 设置工具栏拖动功能
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
        
        // 从CSS获取初始位置
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
     * 设置事件监听
     */
    setupEventListeners() {
        // Canvas 鼠标事件
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        this.canvas.addEventListener('mouseleave', () => this.handleMouseLeave());
        
        // 右键清除
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.handleRightClick(e);
            return false;
        });
        
        // Canvas 容器滚动事件监听（用于移动端边缘提示）
        const canvasContainer = this.canvas.parentElement;
        if (canvasContainer) {
            this.setupScrollEdgeDetection(canvasContainer);
            // 初始化时将canvas滚动到中间位置，确保内容可见
            this.centerCanvas(canvasContainer);
        }
        
        // 操作按钮
        document.getElementById('clearBtn').addEventListener('click', () => this.clearMap());
        
        // 场景选择下拉框（注释掉，使用输入框版本）
        document.getElementById('bgSelect').addEventListener('change', (e) => this.changeBgId(e.target.value));
        
        // 宽场景复选框
        const wideScreenCheckbox = document.getElementById('wideScreenCheckbox');
        if (wideScreenCheckbox) {
            wideScreenCheckbox.addEventListener('change', (e) => {
                this.isWideScreen = e.target.checked;
                this.saveStatusEnabled();
                this.render();
                // 切换宽屏模式后重新居中canvas
                const canvasContainer = this.canvas.parentElement;
                if (canvasContainer) {
                    setTimeout(() => this.centerCanvas(canvasContainer), 100);
                }
                console.log('宽场景模式:', this.isWideScreen);
            });
        }
        
        // 应用到 ROM 编辑器按钮
        const applyToRomBtn = document.getElementById('applyToRomBtn');
        if (applyToRomBtn) {
            // 如果是从 ROM 编辑器打开的，显示此按钮
            if (window.opener && window.opener.app) {
                applyToRomBtn.style.display = 'block';
            }
            applyToRomBtn.addEventListener('click', () => this.applyToRomEditor());
        }
    }
    
    /**
     * 设置滚动边缘检测（移动端优化）
     */
    setupScrollEdgeDetection(container) {
        const updateEdgeClasses = () => {
            const scrollLeft = container.scrollLeft;
            const scrollWidth = container.scrollWidth;
            const clientWidth = container.clientWidth;
            
            // 检测是否在左边缘（允许5px误差）
            if (scrollLeft <= 5) {
                container.classList.add('at-left-edge');
            } else {
                container.classList.remove('at-left-edge');
            }
            
            // 检测是否在右边缘（允许5px误差）
            if (scrollLeft + clientWidth >= scrollWidth - 5) {
                container.classList.add('at-right-edge');
            } else {
                container.classList.remove('at-right-edge');
            }
        };
        
        // 初始检测
        updateEdgeClasses();
        
        // 滚动时更新
        container.addEventListener('scroll', updateEdgeClasses);
        
        // 窗口大小改变时更新
        window.addEventListener('resize', updateEdgeClasses);
    }
    
    /**
     * 将canvas滚动到中间位置（移动端初始化）
     */
    centerCanvas(container) {
        // 使用requestAnimationFrame确保DOM已经渲染完成
        requestAnimationFrame(() => {
            const scrollWidth = container.scrollWidth;
            const clientWidth = container.clientWidth;
            
            // 如果内容宽度大于容器宽度，则居中显示
            if (scrollWidth > clientWidth) {
                const centerPosition = (scrollWidth - clientWidth) / 2;
                container.scrollLeft = centerPosition;
            }
        });
    }
    
    /**
     * 选择工具
     */
    selectTool(type, id = null) {
        this.currentTool = type;
        this.currentTileId = type === 'tile' ? id : null;
        this.currentEnemyId = type === 'enemy' ? id : null;
        
        // 更新UI
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
        
        if (type === 'tile') {
            const btn = document.querySelector(`[data-tile-id="${id}"]`);
            if (btn) btn.classList.add('active');
            document.getElementById('currentTool').textContent = `Tile ${id}`;
        } else if (type === 'enemy') {
            const btn = document.getElementById(`enemyBtn${id}`);
            if (btn) btn.classList.add('active');
            document.getElementById('currentTool').textContent = `Enemy ${id}`;
        } else if (type === 'player') {
            document.getElementById('playerBtn').classList.add('active');
            document.getElementById('currentTool').textContent = 'Player';
        } else if (type === 'door') {
            document.getElementById('doorBtn').classList.add('active');
            document.getElementById('currentTool').textContent = 'Door';
        }
        
        this.render();
    }
    
    /**
     * 鼠标按下处理
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
     * 鼠标松开处理
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
     * 鼠标移动处理
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
            
            // 第一行显示禁止标志
            if (y === 0 && this.currentTool) {
                document.getElementById('mousePos').textContent = `(${x}, ${y}) - 禁止放置`;
            } else {
                document.getElementById('mousePos').textContent = `(${x}, ${y})`;
            }
        } else {
            this.mouseGridPos = null;
            document.getElementById('mousePos').textContent = '-';
        }
        
        // 根据按下的按键执行不同操作
        if (this.mouseGridPos) {
            if (this.isLeftButtonDown && this.currentTool) {
                // 左键：连续绘制
                this.performDraw(this.mouseGridPos.x, this.mouseGridPos.y, true);
            } else if (this.isRightButtonDown) {
                // 右键：连续删除
                this.performErase(this.mouseGridPos.x, this.mouseGridPos.y);
            }
        }
        
        this.render();
    }
    
    /**
     * 鼠标离开处理
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
     * 点击处理
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
     * 右键清除处理
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

    //禁止放置区域
    isProhibitedArea(x, y) {
        // 第一行禁止放置
         if (y === 0 && this.currentTool.includes('tile')
            // 玩家不能放置在第二屏幕
            || (this.currentTool === 'player' && (x >= Config.GRID_WIDTH / 2))
            // 如果非宽屏模式，门不能放在左屏幕的最后一格
            || (this.isWideScreen === false && this.currentTool === 'door' && (x === (Config.GRID_WIDTH / 2 -1)))
            ){
                return true;
            }
        return false;
    }
    
    
    /**
     * 执行绘制操作（用于点击和拖拽）
     */
    performDraw(x, y, isDragging = false) {
        //if (!this.currentTool) return;
        
        // 第一行（y=0）禁止放置贴图 玩家不能放置在第二屏幕
        if (this.isProhibitedArea(x, y)) {
            return;
        }
        
        if (this.currentTool === 'tile' && this.currentTileId) {
            // 放置tile
            this.mapData[y][x] = this.currentTileId;
        } else if (this.currentTool === 'enemy' && this.currentEnemyId) {
            if(this.enemies.length >= Config.MAX_ENEMIES){
                app.showMessage('warning', i18n.t("forbiddenPleaceEnemyWarning"));
                return;
            }
            // 放置敌人（检查是否已存在）
            const existingIndex = this.enemies.findIndex(e => e.x === x && e.y === y);
            if (existingIndex >= 0) {
                // 如果不是自己则替换现有敌人 是自己则转换方向
                const realId = Enemy.getRealId(this.currentEnemyId);
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
                // 添加新敌人
                this.enemies.push(new Enemy(this.currentEnemyId, x, y));
            }
        } else if (this.currentTool === 'player') {
            // 放置玩家
            this.playerPos = { x, y };
        } else if (this.currentTool === 'door') {
            // 放置门
            this.doorPos = { x, y };
        } else if (this.currentTool === 'eraser') {
            // 执行清除操作
            this.performErase(x, y);
            //return; // 提前返回，避免重复渲染
        }
        this.saveStatusEnabled();
        // 立即渲染更新
        this.render();
        // Update the map and monster data displays.
        this.updateDataDisplays();
    }
    
    /**
     * 执行清除操作（右键）
     */
    performErase(x, y) {
        // 清除当前格子
        this.mapData[y][x] = 0;
        
        // 清除玩家
        if (this.playerPos && this.playerPos.x === x && this.playerPos.y === y) {
            this.playerPos = null;
        }
        
        // 清除门（2x2）
        if (this.doorPos) {
            if (x >= this.doorPos.x && x < this.doorPos.x + 2 &&
                y >= this.doorPos.y && y < this.doorPos.y + 2) {
                this.doorPos = null;
            }
        }
        
        // 清除敌人
        this.enemies = this.enemies.filter(e => {
            if (e.x === x && e.y === y) return false;
            
            // 检查是否点击了高个子敌人的上半部分
            const enemyName = Config.ENEMY_PREFIX + `${e.getRealId()}`;
            const sizeConfig = Config.RESOURCE_IMG_CONFIG[enemyName];
            if (sizeConfig && sizeConfig.imgBlockIndex.length / 2 > 1) {
                const topY = e.y - sizeConfig.imgBlockIndex.length / 2 + 1;
                // 如果点击位置在敌人范围内（包括上半部分）
                if (e.x === x && y >= topY && y <= e.y) {
                    return false; // 删除这个敌人
                }
            }
            
            return true;
        });
        //this.modified = true;
        this.saveStatusEnabled();
        // 立即渲染更新
        this.render();

        this.updateDataDisplays();
    }

    saveStatusEnabled(){
        this.modified = true;
        document.getElementById('saveBtn').disabled = false;
    }
    
    /**
     * 清空地图
     */
    clearMap() {
        if (confirm('确定要清空地图吗？')) {
            this.mapData = Array(Config.GRID_HEIGHT).fill(null).map(() => Array(Config.GRID_WIDTH).fill(0));
            this.playerPos = null;
            this.doorPos = null;
            this.enemies = [];
            //this.modified = true;
            this.saveStatusEnabled();
            this.render();
        }
    }
    
    /**
     * 渲染
     */
    render() {
        if(this.testMode){
            return;
        }

        // 清空画布
        // this.ctx.fillStyle = '#000000';
        // this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if(!this.isWideScreen){
            //将绘制在 canvas 中央
            this.ctx.save();
            this.ctx.translate(this.canvas.width / 4, 0);
        }

        
        // 1. 绘制背景
        if (this.images.get(Config.BG)) {
            this.ctx.drawImage(this.images.get(Config.BG), 0, 0, this.canvas.width / 2, this.canvas.height);
            if(this.isWideScreen){
                this.ctx.drawImage(this.images.get(Config.BG), this.canvas.width / 2, 0, this.canvas.width / 2, this.canvas.height);
            }
        }
        
        // 2. 绘制网格（半透明）
        this.drawGrid();

        // 3. 绘制门（2x2格子，64x64像素）
        if (this.doorPos && this.images.get(Config.DOOR)) {
            this.ctx.drawImage(
                this.images.get(Config.DOOR),
                this.doorPos.x * Config.TILE_SIZE,
                this.doorPos.y * Config.TILE_SIZE,
                Config.TILE_SIZE * 2,
                Config.TILE_SIZE * 2
            );
        }
        
        // 4. 绘制地图tile
        for (let y = 0; y < Config.GRID_HEIGHT; y++) {
            for (let x = 0; x < Config.GRID_WIDTH; x++) {
                const tileId = this.mapData[y][x];
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
        
        // 5. 绘制玩家
        if (this.playerPos && this.images.get(Config.PLAYER)) {
            this.ctx.drawImage(
                this.images.get(Config.PLAYER),
                this.playerPos.x * Config.TILE_SIZE,
                this.playerPos.y * Config.TILE_SIZE,
                Config.TILE_SIZE,
                Config.TILE_SIZE
            );
        }
        
        // 6. 绘制敌人
        for (const enemy of this.enemies) {
            enemy.render(this.ctx, this.images);
        }

        //如果不是宽场景,则绘制遮罩
        // if(!this.isWideScreen){
        //     this.ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
        //     this.ctx.fillRect(this.canvas.width / 2, 0, this.canvas.width / 2, this.canvas.height);
        // }
        
        // 7. 绘制预放置框
        if (this.mouseGridPos && this.currentTool) {
            this.drawPreview();
        }

        //恢复 canvas 绘制边界
        if(!this.isWideScreen){
            //将绘制在 canvas 中央
            //绘制边界
            //两边涂黑
            this.ctx.fillStyle = '#000000';
            this.ctx.fillRect(-this.canvas.width / 4, 0, this.canvas.width / 4, this.canvas.height);
            this.ctx.fillRect(this.canvas.width  / 2, 0, this.canvas.width / 4, this.canvas.height);

            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(0 , 0, this.canvas.width / 2, this.canvas.height);
            this.ctx.restore();
        }else{
            //绘制边界
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }
    
    /**
     * 绘制网格
     */
    drawGrid() {
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        this.ctx.lineWidth = 1;
        
        // 垂直线
        for (let x = 0; x <= Config.GRID_WIDTH; x++) {
            this.ctx.beginPath();
            this.ctx.moveTo(x * Config.TILE_SIZE, 0);
            this.ctx.lineTo(x * Config.TILE_SIZE, this.canvas.height);
            this.ctx.stroke();
        }
        
        // 水平线
        for (let y = 0; y <= Config.GRID_HEIGHT; y++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y * Config.TILE_SIZE);
            this.ctx.lineTo(this.canvas.width, y * Config.TILE_SIZE);
            this.ctx.stroke();
        }
    }
    
    /**
     * 绘制预放置框
     */
    drawPreview() {
        const { x, y } = this.mouseGridPos;
        
        // 第一行禁止放置  玩家不能放置在第二屏幕
        if (this.isProhibitedArea(x, y)) {
            // 绘制红色禁止框
            this.ctx.strokeStyle = '#FF0000';
            this.ctx.lineWidth = 3;
            this.ctx.strokeRect(
                x * Config.TILE_SIZE,
                y * Config.TILE_SIZE,
                Config.TILE_SIZE,
                Config.TILE_SIZE
            );
            
            // 绘制禁止标志
            this.ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
            this.ctx.fillRect(
                x * Config.TILE_SIZE,
                y * Config.TILE_SIZE,
                Config.TILE_SIZE,
                Config.TILE_SIZE
            );
            
            return;
        }
        
        // 门是2x2格子，需要特殊处理
        if (this.currentTool === 'door') {
            // 绘制2x2高亮框
            this.ctx.strokeStyle = '#FFD700';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(
                x * Config.TILE_SIZE,
                y * Config.TILE_SIZE,
                Config.TILE_SIZE * 2,
                Config.TILE_SIZE * 2
            );
            
            // 绘制半透明预览
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

            // 敌人预览 - 根据配置尺寸绘制
            const enemyName = Config.ENEMY_PREFIX + `${realId}`;
            const sizeConfig = Config.RESOURCE_IMG_CONFIG[enemyName];
            const widthInTiles = sizeConfig ? sizeConfig.imgBlockIndex[0].length / 2 : 1;
            const heightInTiles = sizeConfig ? sizeConfig.imgBlockIndex.length / 2 : 1;
            
            // 高个子敌人以底部为坐标，预览框也要向上显示
            const previewY = y - heightInTiles + 1;
            
            // 绘制高亮框
            this.ctx.strokeStyle = '#FFD700';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(
                x * Config.TILE_SIZE,
                previewY * Config.TILE_SIZE,
                Config.TILE_SIZE * widthInTiles,
                Config.TILE_SIZE * heightInTiles
            );
            // 绘制半透明预览

            this.ctx.globalAlpha = 0.5;
            if( x > Config.GRID_WIDTH / 2 ){
                this.currentEnemyId = (this.currentEnemyId | 0x80)
            }else{
                this.currentEnemyId = (this.currentEnemyId & 0x7F)

            }

            const facingReverse = Enemy.getFacing(this.currentEnemyId);
            // 如果反向,则反着画图像

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

            // 其他工具：绘制1x1高亮框
            this.ctx.strokeStyle = '#FFD700';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(
                x * Config.TILE_SIZE,
                y * Config.TILE_SIZE,
                Config.TILE_SIZE,
                Config.TILE_SIZE
            );
            
            // 绘制半透明预览
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
    
    /**
     * 解析敌人数据用于显示
     */
    // decodeEnemyDataForDisplay(enemyBytes) {
    //     if (enemyBytes.length === 0) {
    //         return '无敌人数据';
    //     }
        
    //     const lines = [];
    //     const firstByte = enemyBytes[0];
    //     const enemyCount = (firstByte - 1) / 2;
        
    //     lines.push(`${enemyBytes[0].toString(16).toUpperCase().padStart(2, '0')}: 敌人数量标识 (${enemyCount}个敌人)`);
        
    //     for (let i = 1; i < enemyBytes.length; i += 2) {
    //         if (i + 1 < enemyBytes.length) {
    //             const enemyId = enemyBytes[i];
    //             const position = enemyBytes[i + 1];
    //             const x = Math.floor(position / 16);
    //             const y = position % 16;
                
    //             const hexId = enemyId.toString(16).toUpperCase().padStart(2, '0');
    //             const hexPos = position.toString(16).toUpperCase().padStart(2, '0');
                
    //             lines.push(`${hexId} ${hexPos}: 敌人${enemyId} 位于 (${x}, ${y})`);
    //         }
    //     }
        
    //     return lines.join('<br>');
    // }
}
