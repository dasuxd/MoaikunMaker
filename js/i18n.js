/**
 * 国际化配置
 */
const i18n = {
    currentLang: 'zh-CN',
    
    translations: {
        'zh-CN': {
            // Top Bar
            'title': 'Moai-kun Maker',
            'selectRom': '📁 选择 ROM 文件',
            'clearCache': '🗑️ 清除缓存',
            'clearCacheTitle': '清除缓存的 ROM',
            
            // Sidebar
            'levelList': '📋 关卡列表',
            'totalLevels': '🎮 关卡总数:',
            'editLevelOrder': '✏️ 编辑关卡顺序',
            'address': '(地址: 0x0BD3)',
            'cancel': '❌ 取消',
            'saveOrder': '✔️ 保存顺序',
            'dragTip': '💡 拖动关卡可调整顺序',
            
            // Memory
            'memoryUsage': '💾 内存使用情况',
            
            // Toolbar
            'config': '🛠️ 配置',
            'dragToMove': '拖动移动',
            'operations': '操作',
            'selectScene': '选择场景',
            'scene': '场景',
            'wideScene': '📺 宽场景',
            'clearMap': '清空地图',
            'exportData': '导出数据',
            'applyToRom': '应用到 ROM 编辑器',
            'tools': '工具',
            'tiles': '图块',
            'enemies': '敌人',
            'special': '特殊',
            
            // Canvas Info
            'gridSize': '网格大小:',
            'currentTool': '当前工具:',
            'notSelected': '未选择',
            'mousePosition': '鼠标位置:',
            
            // Buttons
            'testLevel': '🎮 测试关卡',
            'testRom': '🎮 测试 ROM',
            'stopEmulator': '⏹️ 结束模拟',
            'saveLevel': '💾 保存关卡',
            'writeToRom': '📝 写入 ROM',
            'downloadRom': '⬇️ 下载 ROM',
            'shareLevel': '🔗 分享关卡',
            
            // Info Panel
            'mapRomAddress': '地图 ROM 地址',
            'mapCpuAddress': '地图 CPU 地址',
            'monsterRomAddress': '怪物ROM地址',
            'monsterCpuAddress': '怪物CPU地址',
            'currentSize': '当前大小',
            'bytes': '字节',
            
            // Hex Editor
            'mapDataLabel': '🗺️ 地图数据 (不包含结束符 FF)',
            'readOnly': '[只读参考]',
            'hexDataPlaceholder': '输入十六进制数据，如: A1 B2 C3 D4...',
            'monsterDataLabel': '👾 怪物数据',
            'monsterDataFormat': '(格式: 第1字节=怪物数*2+1, 后续为 [类型 位置] 对)',
            'monsterDataPlaceholder': '输入怪物数据，如: 01 (无怪物) 或 03 01 DD (一个01类型怪物在DD位置)',
            
            // Welcome Screen
            'welcomeTitle': '🎮 欢迎使用 Moai-kun Maker',
            'welcomeTip1': '游戏需要您亲自上传 ROM，如果您上传了正确的游戏 ROM 却加载失败可以给我提交 Issue。',
            'welcomeTip2': '本游戏可以进行关卡分享，直接给朋友发送链接即可。',
            'welcomeTip3': '如果通过链接进入但未加载 ROM，只需上传 ROM 后，分享的关卡会自动开始。',
            'welcomeTip4': '这是初级版本，可能存在一些小 BUG，欢迎提交 Issue 反馈。',
            'welcomeUpload': '📤 上传 ROM 开始使用',
            
            // Operation Info
            'operationSummaryLabel': '操作简介:',
            'operationSummary': '移动(WASD)  |  攻击(J)  | 跳跃(K) | 开始(Enter) | 选择(Shift)',

            // others
            'levelCount' : '关卡总数',
            'levelLabel': '关卡 ',
            'selectNesRomFile':'📁 选择 NES ROM 文件',


            //messages
            'levelDataExceedBoundaryError': '关卡数据总大小超出边界！第 {level} 关的结束地址为 {endAddr}，超过最大地址 {maxAddr}。无法保存！',
            'loadedFromCacheMessage': '已从缓存加载: {fileName}',
            'romNotFoundWarning':'没有找到游戏 ROM，分享关卡将在加载 ROM 文件后自动运行。',
            'loadShareLevelError': '加载分享关卡失败',
            'loadSharedLevelSuccess':'🎮 已加载分享的关卡！',
            'invalidLevelCountMessageError':'关卡总数必须在1-255之间',
            'levelCountUpdateSuccess':'关卡总数已更新为 {levelCount}',
            'levelCountUpdateFailedError':'关卡总数更新失败：{error}',
            'cacheCleanSuccess':'缓存已清除',
            'cacheCleanError':'清除缓存失败',
            'loadFileSuccess':'文件加载成功: {fileNameStr}, 共 {length} 字节)',
            'emulatorNotRunningWarning':'模拟器未运行',
            'emulatorStopInfo':'✋ 模拟器已停止',
            'pleaseSelectLevelFirstWarning':'请先选择一个关卡',
            'copyShareLevelLinkSuccess':'🔗 分享链接已复制到剪贴板！',
            'copyShareLevelLinkError':'生成分享链接失败',
            'testingCurrentLevelSuccess':'🎮 正在测试当前关卡...',
            'romNotLoadedError': '请先加载 ROM 文件',
            'emulatorStartSuccess': '🎮 模拟器已启动！',
            'editorNotInitError': '可视化编辑器未初始化',
            'saveMapFailedError': '保存地图数据失败！',
            'monsterDataError': '怪物数据错误 {error}',
            'saveMapSuccess': '关卡 {currentLevel} 保存成功！地图和怪物数据已更新。',
            'saveLevelFailedError': '保存失败: {error}' ,
            'write2RomSuccess': '所有数据已写入ROM！' ,
            'write2RomFiledError': '写入ROM失败: {error}' ,
            'cancelModifyWarning': '已取消修改' ,
            'romDownloadSuccess': 'ROM 文件下载成功!' ,
            'levelReorderSuccess': '关卡已移动：{draggedIndex} → {targetIndex}' ,
            'levelReorderError': '关卡移动失败：{error}' ,
            'changeLevelOrderInfo': '📝 拖拽关卡来调整关卡顺序' ,
            'changeLevelOrderCancelWarning': '✖️ 已取消修改' ,
            'changeLevelOrderSuccess': '✅ 关卡顺序已保存（仅在内存中，请点击“写入ROM”按钮保存到文件）' ,
            'forbiddenPleaceEnemyWarning': '敌人数量已达上限，无法放置更多敌人' ,
            
            'emptyEnemyDataError': '怪物数据不能为空' ,
            'invalidHexValue': '无效的十六进制值: {hexValue}' ,



        },
        
        'en-US': {
            // Top Bar
            'title': 'Moai-kun Maker',
            'selectRom': '📁 Select ROM File',
            'clearCache': '🗑️ Clear Cache',
            'clearCacheTitle': 'Clear Cached ROM',
            
            // Sidebar
            'levelList': '📋 Level List',
            'totalLevels': '🎮 Total Levels:',
            'editLevelOrder': '✏️ Edit Level Order',
            'address': '(Address: 0x0BD3)',
            'cancel': '❌ Cancel',
            'saveOrder': '✔️ Save Order',
            'dragTip': '💡 Drag levels to reorder',
            
            // Memory
            'memoryUsage': '💾 Memory Usage',
            
            // Toolbar
            'config': '🛠️ Config',
            'dragToMove': 'Drag to Move',
            'operations': 'Operations',
            'selectScene': 'Select Scene',
            'scene': 'Scene',
            'wideScene': '📺 Wide Screen',
            'clearMap': 'Clear Map',
            'exportData': 'Export Data',
            'applyToRom': 'Apply to ROM Editor',
            'tools': 'Tools',
            'tiles': 'Tiles',
            'enemies': 'Enemies',
            'special': 'Special',
            
            // Canvas Info
            'gridSize': 'Grid Size:',
            'currentTool': 'Current Tool:',
            'notSelected': 'Not Selected',
            'mousePosition': 'Mouse Pos:',
            
            // Buttons
            'testLevel': '🎮 Test Level',
            'testRom': '🎮 Test ROM',
            'stopEmulator': '⏹️ Stop Emulator',
            'saveLevel': '💾 Save Level',
            'writeToRom': '📝 Write ROM',
            'downloadRom': '⬇️ Download ROM',
            'shareLevel': '🔗 Share Level',
            // Info Panel
            'mapRomAddress': 'Map ROM Address',
            'mapCpuAddress': 'Map CPU Address',
            'monsterRomAddress': 'Monster ROM Address',
            'monsterCpuAddress': 'Monster CPU Address',
            'currentSize': 'Current Size',
            'bytes': 'Bytes',
            
            // Hex Editor
            'mapDataLabel': '🗺️ Map Data (Excluding End FF)',
            'readOnly': '[Read Only]',
            'hexDataPlaceholder': 'Enter hex data, e.g.: A1 B2 C3 D4...',
            'monsterDataLabel': '👾 Monster Data',
            'monsterDataFormat': '(Format: 1st byte=monster count*2+1, followed by [type position] pairs)',
            'monsterDataPlaceholder': 'Enter monster data, e.g.: 01 (no monsters) or 03 01 DD (one type 01 monster at DD)',
            
            // Welcome Screen
            'welcomeTitle': '🎮 Welcome to Moai-kun Maker',
            'welcomeTip1': 'You need to upload the ROM yourself. If you upload a correct ROM but it fails to load, please submit an Issue.',
            'welcomeTip2': 'You can share levels with friends by simply sending them the link.',
            'welcomeTip3': 'If you access via a shared link without ROM loaded, just upload the ROM and the shared level will start automatically.',
            'welcomeTip4': 'This is an early version and may have some bugs. Feel free to submit Issues for feedback.',
            'welcomeUpload': '📤 Upload ROM to Start',
            
            // Operation Info
            'operationSummaryLabel': 'Controls:',
            'operationSummary': 'Move (WASD)  |  Attack (J)  |  Jump (K)|  Start (Enter) | Select (Shift)',
        
            // others
            'levelCount' : 'Total Levels',
            'levelLabel': 'Level ',
            'selectNesRomFile': '📁 Select NES ROM File',

            //messages
            'levelDataExceedBoundaryError': 'Level data total size exceeds boundary! Level {level} ends at address {endAddr}, which exceeds the maximum address {maxAddr}. Cannot save!',
            'loadedFromCacheMessage': 'Loaded from cache: {fileName}',
            'romNotFoundWarning': 'Game ROM not found. The shared level will auto-run after you load a ROM file.',
            'loadShareLevelError': 'Failed to load shared level',
            'loadSharedLevelSuccess': '🎮 Shared level loaded successfully!',
            'invalidLevelCountMessageError': 'Total number of levels must be between 1 and 255',
            'levelCountUpdateSuccess': 'Total level count updated to {levelCount}',
            'levelCountUpdateFailedError': 'Failed to update level count: {error}',
            'cacheCleanSuccess': 'Cache cleared successfully',
            'cacheCleanError': 'Failed to clear cache',
            'loadFileSuccess': 'File loaded successfully: {fileNameStr}, {length} bytes)',
            'emulatorNotRunningWarning': 'Emulator is not running',
            'emulatorStopInfo': '✋ Emulator stopped',
            'pleaseSelectLevelFirstWarning': 'Please select a level first',
            'copyShareLevelLinkSuccess': '🔗 Share link copied to clipboard!',
            'copyShareLevelLinkError': 'Failed to generate share link',
            'testingCurrentLevelSuccess': '🎮 Testing current level...',
            'romNotLoadedError': 'Please load a ROM file first',
            'emulatorStartSuccess': '🎮 Emulator started!',
            'editorNotInitError': 'Visual editor not initialized',
            'saveMapFailedError': 'Failed to save map data!',
            'monsterDataError': 'Monster data error {error}',
            'saveMapSuccess': 'Level {currentLevel} saved successfully! Map and monster data updated.',
            'saveLevelFailedError': 'Save failed: {error}',
            'write2RomSuccess': 'All data written to ROM!',
            'write2RomFiledError': 'Failed to write to ROM: {error}',
            'cancelModifyWarning': 'Modification canceled',
            'romDownloadSuccess': 'ROM file downloaded successfully!',
            'levelReorderSuccess': 'Level moved: {draggedIndex} → {targetIndex}',
            'levelReorderError': 'Failed to reorder level: {error}',
            'changeLevelOrderInfo': '📝 Drag levels to reorder them',
            'changeLevelOrderCancelWarning': '✖️ Modification canceled',
            'changeLevelOrderSuccess': '✅ Level order saved (in memory only, click "Write to ROM" button to save to file)',
            'forbiddenPleaceEnemyWarning': 'Enemy limit reached, cannot place more enemies',
            'emptyEnemyDataError': 'Monster data cannot be empty',
            'invalidHexValue': 'Invalid hex value: {hexValue}',
        }
    },
    
    /**
     * 获取翻译文本
     */
    t(key, params = {}) {
        let translation = this.translations[this.currentLang]?.[key];
        if (!translation) {
            console.warn('缺失翻译 →', this.currentLang, key);
            return key;
        }

        return translation.replace(/{([^}]+)}/g, (match, placeholder) => {
            // 去掉可能的前后空格
            const key = placeholder.trim();
            
            if (key in params) {
                return params[key];
            }
            
            // 可选：支持数字索引作为 fallback
            const num = Number(key);
            if (!isNaN(num) && num in params) {
                return params[num];
            }
            
            // 没找到就保留原样（或返回警告）
            console.warn(`占位符未替换：{${key}} 在 ${this.currentLang}.${this.key}`);
            return match;
        });
    },
    
    /**
     * 切换语言
     */
    setLanguage(lang) {
        this.currentLang = lang;
        localStorage.setItem('language', lang);
        this.updatePage();
    },
    
    /**
     * 更新页面所有文本
     */
    updatePage() {
        // 更新所有带 data-i18n 属性的元素
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const text = this.t(key);
            
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                element.placeholder = text;
            } else {
                element.textContent = text;
            }
        });
        
        // 更新 placeholder 属性
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            element.placeholder = this.t(key);
        });
        
        // 更新 title 属性
        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            element.title = this.t(key);
        });
        
        // 更新 select 的 options (场景选择)
        document.querySelectorAll('[data-i18n-options]').forEach(select => {
            const prefix = select.getAttribute('data-i18n-options');
            select.querySelectorAll('option').forEach(option => {
                const value = option.value;
                option.textContent = `${this.t(prefix)} ${value}`;
            });
        });
        
        // 更新 HTML lang 属性
        document.documentElement.lang = this.currentLang;
    },
    
    /**
     * 初始化
     */
    init() {
        // 从 localStorage 读取语言设置
        const savedLang = localStorage.getItem('language');
        if (savedLang) {
            this.currentLang = savedLang;
        }
        
        this.updatePage();
        return this.currentLang;
    }
};