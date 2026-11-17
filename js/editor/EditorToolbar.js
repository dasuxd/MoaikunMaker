class EditorToolbar {
    /**
     * Create tile selection buttons
     */
    static updateButtonImages(editor) {
        // Update tile buttons
        for (let i = 0; i < editor.tileBtns.length; i++) {
            const btn = editor.tileBtns[i];
            const imgName = btn.dataset.imgName;
            editor.updateButtonImage(btn, imgName);
        }

        for(let i = 0; i < editor.enemyBtns.length; i++){
            const btn = editor.enemyBtns[i];
            const imgName = btn.dataset.imgName;
            editor.updateButtonImage(btn, imgName);
        }

        editor.updateButtonImage(editor.playerBtn, editor.playerBtn.dataset.imgName);
        editor.updateButtonImage(editor.doorBtn, editor.doorBtn.dataset.imgName);

        // Re-render canvas
        editor.render();
    }

    /**
     * Update all button images (when scene switches)
     */
    static updateButtonImage(editor, btn, imgName) {
        const img = btn.querySelector('img');
        const unavailable = btn.querySelector('.tool-icon');
        const resource = ResourceManager.getInstance().getResource(editor.currentBgId, imgName);
        const src = typeof resource === 'string' ? resource : resource?.src;
        const disabled = GraphicsCatalog.RESOURCE_IMG_CONFIG[imgName].disabledLevelType.includes(Number(editor.currentBgId));
        const showImage = Boolean(src) && !disabled;
        if (showImage) {
            img.src = src;
        } else {
            img.removeAttribute('src');
        }
        img.hidden = !showImage;
        unavailable.hidden = showImage;
        btn.disabled = !showImage;
    }

    static createButton(editor, type, container, alt, id = null) {
        const btn = document.createElement('button');
        const imgName = id === null ? type : type + '_' + id;
        btn.className = 'tool-btn';
        btn.id = imgName;
        btn.dataset.type = type;
        btn.dataset.imgName = imgName;

        const icon = document.createElement('div');
        icon.className = 'tool-icon';
        const caption = document.createElement('span');
        if (type === 'eraser') {
            icon.textContent = '❌';
            caption.textContent = i18n.t('Eraser') || 'Eraser';
            btn.append(icon, caption);
        } else {
            const config = GraphicsCatalog.RESOURCE_IMG_CONFIG[imgName];
            const img = document.createElement('img');
            img.alt = alt;
            img.style.height = (32 * config.imgBlockIndex.length / config.imgBlockIndex[0].length) + 'px';
            icon.textContent = '🚫';
            caption.textContent = config.nameKey ? i18n.t(config.nameKey) : config.name;
            if (config.nameKey) caption.dataset.i18n = config.nameKey;
            if (config.helpKey) {
                btn.dataset.i18nTitle = config.helpKey;
                btn.title = i18n.t(config.helpKey);
            }
            btn.append(img, icon, caption);
            if (config.isCustom) {
                btn.classList.add('tool-btn-custom');
                const badge = document.createElement('span');
                badge.className = 'tool-custom-badge';
                badge.dataset.i18n = 'nonOriginal';
                badge.textContent = i18n.t('nonOriginal');
                btn.append(badge);
            }
            editor.updateButtonImage(btn, imgName);
        }
        btn.addEventListener('click', () => {
            if (!btn.disabled) editor.selectTool(type, id);
        });
        container.appendChild(btn);
        return btn;
    }

    static createButtons(editor){
        // First remove all buttons
        const specialContainer = document.getElementById('specialButtons');
        const tileContainer = document.getElementById('tileButtons');
        const enemyContainer = document.getElementById('enemyButtons');

        if (specialContainer) specialContainer.innerHTML = '';
        if (tileContainer) tileContainer.innerHTML = '';
        if (enemyContainer) enemyContainer.innerHTML = '';

        // Clear button arrays
        editor.tileBtns = [];
        editor.enemyBtns = [];
        editor.playerBtn = null;
        editor.doorBtn = null;

        editor.createSpecialTileButtons();
        editor.createTileButtons();
        editor.createEnemyButtons();
    }

    static createSpecialTileButtons(editor) {
        const container = document.getElementById('specialButtons');
        editor.playerBtn = editor.createButton("player", container, "Player");
        editor.playerBtn.id = 'playerBtn';

        editor.doorBtn = editor.createButton("door", container, "Door");
        editor.doorBtn.id = 'doorBtn';

        editor.eraserBtn = editor.createButton("eraser", container, "Eraser");
        editor.eraserBtn.id = 'eraserBtn';
    }

    static createTileButtons(editor) {
        const container = document.getElementById('tileButtons');
        // Add tile buttons
        for (let i = 1; i <= 15; i++) {
            const btn = editor.createButton("tile", container, `Tile ${i}`, i);
            editor.tileBtns.push(btn);
        }
    }

    /**
     * Create enemy selection buttons
     */
    static createEnemyButtons(editor) {
        const container = document.getElementById('enemyButtons');
        for (let i = 1; i <= (Penguin.ENABLED ? 15 : 14); i++) {
            const btn = editor.createButton("enemy", container, `Sprite ${i}`, i);
            editor.enemyBtns.push(btn);
        }
    }

    /**
     * Setup toolbar tabs
     */
    static setupToolbarTabs(editor) {
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
    static setupToolbarDrag(editor) {
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
                // if(!editor.isWideScreen){
                //     wideScreenOffset = editor.canvas.width / 4;
                // }
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;

                xOffset = currentX;
                yOffset = currentY;

                setTranslate(currentX, currentY, toolbar);
            }
        }

        function dragEnd(e) {
            // if(!editor.isWideScreen){
            //     e.clientX += editor.canvas.width / 4;
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
}
