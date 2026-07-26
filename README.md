# 🗿 Moai-kun Maker

[English](README.en.md) | 中文  | [日本語](README.ja.md) 

一个基于 Web 的《モアイくん》（Moai-kun）NES 游戏关卡编辑器。
## 🔍 快速预览

### 界面: 
![界面](https://dasuxd.github.io/Pages/MoaikunMaker/docs/info.png)

#### 手机 竖屏
![手机展示1](https://dasuxd.github.io/Pages/MoaikunMaker/docs/phone1.gif)

#### 手机 横屏
![手机展示2](https://dasuxd.github.io/Pages/MoaikunMaker/docs/phone2.gif)


### 游戏：
![游玩](https://dasuxd.github.io/Pages/MoaikunMaker/docs/play.gif)


## ✨ 功能特性

- 🎨 **可视化编辑** - 直观的图形界面编辑关卡
- 🎮 **即时测试** - 内置 NES 模拟器，实时测试你的关卡
- 🔗 **关卡分享** - 生成分享链接，一键分享给朋友
- 💾 **ROM 编辑** - 直接修改并导出 ROM 文件
- 🌐 **多语言支持** - 中文/英文/日文界面无缝切换
- 📋 **关卡管理** - 拖拽排序、批量编辑
- 🛟 **独立关卡备份** - 导入/导出单关卡或完整关卡包，不依赖 ROM 地址
- 📦 **草稿/分享页签** - 独立编辑草稿、导入文件和分享关卡，可追加到正式关卡末尾
- 📴 **未启用关卡保护** - 缩减关卡总数时保留尾部关卡并灰显，避免数据被直接删除

## 🚀 快速开始

### 在线使用

直接访问：[在线演示地址](https://dasuxd.github.io/MoaikunMaker/)

### 本地运行

```bash
# 克隆仓库
git clone https://github.com/dasuxd/MoaikunMaker.git

# 进入目录
cd moaikun-maker

# 使用任意 Web 服务器运行
# 例如 Python
python -m http.server 8000

# 或 Node.js
npx serve

# 然后在浏览器打开 http://localhost:8000
```

## 📖 使用说明

### 1. 上传 ROM

- 点击"📁 选择 ROM 文件"按钮
- 选择你合法拥有的《モアイくん》ROM 文件（.nes）
- 等待加载完成

### 2. 编辑关卡

- 从左侧关卡列表选择要编辑的关卡
- 使用右侧工具栏选择图块/敌人/特殊物品
- 在画布上点击放置，右键删除
- 可调整场景、宽屏等属性

### 3. 测试关卡

- 点击"🎮 测试关卡"在模拟器中运行当前关卡
- 点击"🎮 测试 ROM"测试完整游戏
- 点击"⏹️ 结束模拟"返回编辑

### 4. 保存与分享

- **💾 保存关卡** - 保存修改到内存
- **📝 写入 ROM** - 将所有修改写入 ROM 数据
- **⬇️ 下载 ROM** - 下载修改后的 ROM 文件
- **🔗 分享关卡** - 生成分享链接，复制发送给朋友
- **📤 导出当前关卡** - 将当前编辑（包括未保存内容）导出为 `.moailevel`
- **🧰 导出全部关卡** - 将正式关卡和草稿导出为灾难恢复包 `.moaipack`
- **📥 导入关卡** - 单关卡进入草稿箱；完整关卡包可恢复正式关卡组
- **🧰 导出全部草稿** - 将草稿/分享关卡单独导出为 `.moaidrafts`
- **➕ 添加到正式关卡** - 在有效关卡末尾、灰色未启用关卡之前插入草稿副本

## 🎮 使用前须知

**本工具需要合法的游戏 ROM 文件才能使用**

1. ✅ 从你拥有的实体卡带备份 ROM
2. ✅ 或从合法渠道购买数字版本
3. ❌ 请勿从非法网站下载盗版 ROM

## 🛠️ 技术栈

- **前端框架**: 原生 JavaScript (ES6+)
- **NES 模拟器**: [JSNES](https://github.com/bfirsh/jsnes)
- **图形渲染**: HTML5 Canvas
- **样式**: CSS3
- **构建工具**: 无需构建，直接运行

## 📁 项目结构

```
moaikun-maker/
├── index.html              # 主页面
├── css/
│   ├── style.css          # 主样式
│   ├── level_editor.css   # 编辑器样式
│   └── sortable.css       # 排序组件样式
├── js/
│   ├── app.js             # 主应用逻辑
│   ├── Config.js          # 配置文件
│   ├── DataConverter.js   # 数据转换
│   ├── Enemy.js           # 敌人配置
│   ├── i18n.js            # 国际化主文件
│   ├── Level.js           # 关卡数据结构
│   ├── LevelEditor.js     # 关卡编辑器
│   ├── MobileGameController.js # 移动端游戏控制器
│   ├── NesEmulator.js     # 模拟器封装
│   ├── ResourceManager.js # 资源管理
│   ├── RomCache.js        # ROM 缓存
│   ├── RomEditor.js       # ROM 编辑
│   ├── lang/              # 语言文件目录
│   │   ├── zh-CN.js       # 简体中文
│   │   ├── en-US.js       # 英文
│   │   └── ja-JP.js       # 日文
│   └── lib/               # 第三方库
│       └── jsnes.min.js   # NES 模拟器核心
└── README.md              # 项目说明
```

## ⚖️ 法律声明

本工具仅供学习和研究目的使用。

- ✅ 本软件是一个**关卡编辑器工具**，不包含任何游戏 ROM 或受版权保护的资源
- ⚠️ 用户需要自行提供合法拥有的游戏 ROM 文件
- 🚫 不支持、不鼓励任何盗版行为
- 📜 用户需遵守所在地区的版权法律法规
- 🛡️ 作者不对用户使用本工具产生的任何法律后果负责

**モアイくん (Moai-kun)** 是 Konami 的商标。本项目与 Konami 公司无任何关联、认可或赞助关系。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的修改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个 Pull Request

## 📝 开发计划

- [ ] 后台处理关卡数据 (如果未来值得做)

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源。

## 🙏 致谢

- [JSNES](https://github.com/bfirsh/jsnes) - NES 模拟器核心
- [Sortable](https://github.com/SortableJS/Sortable) - Sortable 框架
- Konami - 原游戏开发商
- 所有贡献者和测试者

## 📧 联系方式

如有问题或建议，请通过以下方式联系：

- GitHub Issues: [提交 Issue](https://github.com/dasuxd/MoaikunMaker/issues)
- Email: aihidao@126.com

---

⭐ 如果这个项目对你有帮助，请给个 Star！
