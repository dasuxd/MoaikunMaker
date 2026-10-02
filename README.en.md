# 🗿 Moai-kun Maker

English | [中文](README.md) | [日本語](README.ja.md) 

A web-based level editor for the NES game "モアイくん (Moai-kun)".
## 🔍 Quick Preview

### Interface: 
![Interface](https://dasuxd.github.io/Pages/MoaikunMaker/docs/info.png)

#### Mobile Portrait
![Mobile Demo 1](https://dasuxd.github.io/Pages/MoaikunMaker/docs/phone1.gif)

#### Mobile Landscape
![Mobile Demo 2](https://dasuxd.github.io/Pages/MoaikunMaker/docs/phone2.gif)


### Gameplay: 
![Play](https://dasuxd.github.io/Pages/MoaikunMaker/docs/play.gif)

## ✨ Features

- 🎨 **Visual Editing** - Intuitive graphical interface for level design
- 🎮 **Instant Testing** - Built-in NES emulator for real-time level testing
- 🔗 **Level Sharing** - Generate shareable links with one click
- 💾 **ROM Editing** - Directly modify and export ROM files
- 🌐 **Multi-language** - Seamless switching between Chinese/English/Japanese
- 📋 **Level Management** - Drag-and-drop sorting, batch editing
- 🛟 **Independent Backups** - Import/export one level or a full pack without ROM addresses
- 📦 **Drafts / Shared Tab** - Edit drafts, imports and shared levels independently, then append them to the formal list
- 📴 **Disabled-Level Protection** - Reducing the level count keeps trailing levels visible and disabled instead of deleting them

## 🚀 Quick Start

### Online Usage

Visit: [Demo Link](https://dasuxd.github.io/MoaikunMaker/)

### Local Setup

```bash
# Clone the repository
git clone https://github.com/dasuxd/MoaikunMaker.git

# Navigate to directory
cd moaikun-maker

# Run with any web server
# Using Python
python -m http.server 8000

# Or using Node.js
npx serve

# Then open http://localhost:8000 in your browser
```

## 📖 Usage Guide

### 1. Upload ROM

- Click "📁 Select ROM File" button
- Select your legally owned Moai-kun ROM file (.nes)
- Wait for loading to complete

### 2. Edit Levels

- Select a level from the left sidebar
- Use the right toolbar to choose tiles/enemies/special items
- Left-click to place, right-click to delete
- Adjust scene, wide screen, and other properties

### 3. Test Levels

- Click "🎮 Test Level" to run current level in emulator
- Click "🎮 Test ROM" to test the complete game
- All previews/downloads use expanded Mapper 2 ROMs (128 KiB PRG). The uploaded source stays intact.
- “Up to switch view” is off by default and experimental. Off keeps fixed narrow maps and looping wide maps. On starts with fixed narrow / native bounded wide views; press Up during play to toggle centered looping follow, with a transition of at most 4 pixels per frame. Wide pause free-look remains available; narrow free-look requires looping view. Horizontal bat wrapping follows this setting.
- The original `START / CONTINUE` password menu is restored. Test Level automatically chooses `START`; change view with Up after starting.
- With this option enabled, stage entry and returning from pause free-look also approach the target smoothly, at most 4 pixels per frame.
- Click "⏹️ Stop Emulator" to return to editing
- Shortcuts: `F5` tests the current level, `F6` stops the emulator, and `Ctrl + S` saves the level. A shortcut does nothing while its button is disabled.

- While the emulator is running, press `Shift + F1` through `Shift + F4` to save to one of four temporary slots, and `F1` through `F4` to load it. Slots can be overwritten; empty slots cannot be loaded.
- On mobile, expand the Emulator menu list for Quick Save, Quick Load, and Stop Emulator. The game pauses while the menu is open and resumes when it closes. Saves use the F1 slot; overwriting a save, loading, and stopping require confirmation.
- Tap Recenter to bring the game back into view and center it horizontally without restarting it.
- Stopping the emulator or loading another ROM clears all four slots. Quick saves are not written to the ROM or browser storage.
- F1, F3, and F4 are browser shortcuts in some browsers, so interception depends on the browser and OS.
- The game Select key is `Alt`, separate from `Shift + F1` through `Shift + F4` quick saving. The bundled jsnes does not save audio chip state, so sound may briefly differ after loading.

### 4. Save & Share

- A new browser cache copies old ROM, level and draft records once without deleting the old cache. Separate cached edits take priority over embedded ROM levels.
- Legacy editor outputs are recognized by local patch/layout features, not a whole-file hash; compatible artwork variants are accepted. A persistent red warning allows continued editing/testing/exporting.
- Export all levels as a backup, then use “Upload clean ROM, keep levels” to replace the base while retaining level order/count, enemies, drafts, unsaved edits and settings. A failed validation or cache commit retains the old project.

- **💾 Save Level** - Save changes to memory
- **📝 Write ROM** - Write all changes to ROM data
- **⬇️ Download ROM** - Download modified ROM file
- **🔗 Share Level** - Generate share link, copy and send to friends
- **📤 Export Current Level** - Export the current edit, including unsaved changes, as `.moailevel`
- **🧰 Export All Levels** - Export formal levels and drafts as a `.moaipack` recovery file
- **📥 Import Level** - Single levels enter the draft box; full packs can restore the formal level set
- **🧰 Export All Drafts** - Export drafts/shared levels separately as `.moaidrafts`
- **➕ Add to Formal Levels** - Insert a draft after active levels and before disabled trailing levels

## 🎮 Important Notice

**This tool requires a legal game ROM file to function**

1. ✅ Dump ROM from your own physical cartridge
2. ✅ Or purchase from official/legal sources
3. ❌ Do NOT download pirated ROMs from illegal websites

## 🛠️ Tech Stack

- **Frontend**: Vanilla JavaScript (ES6+)
- **NES Emulator**: [JSNES](https://github.com/bfirsh/jsnes)
- **Graphics**: HTML5 Canvas
- **Styling**: CSS3
- **Build Tools**: None required, runs directly

## 📁 Project Structure

```
moaikun-maker/
├── index.html              # Main page
├── css/
│   ├── style.css          # Main styles
│   ├── level_editor.css   # Editor styles
│   └── sortable.css       # Sortable component styles
├── js/
│   ├── app.js             # Main application logic
│   ├── Config.js          # Configuration
│   ├── DataConverter.js   # Data conversion
│   ├── Enemy.js           # Enemy configuration
│   ├── i18n.js            # Internationalization main file
│   ├── Level.js           # Level data structure
│   ├── LevelEditor.js     # Level editor
│   ├── MobileGameController.js # Mobile game controller
│   ├── NesEmulator.js     # Emulator wrapper
│   ├── ResourceManager.js # Resource management
│   ├── RomCache.js        # ROM caching
│   ├── RomEditor.js       # ROM editing
│   ├── lang/              # Language files directory
│   │   ├── zh-CN.js       # Simplified Chinese
│   │   ├── en-US.js       # English
│   │   └── ja-JP.js       # Japanese
│   └── lib/               # Third-party libraries
│       └── jsnes.min.js   # NES emulator core
├── tests/                # Emulator state tests
│   └── NesEmulator.quickSave.test.cjs
└── README.md              # Project documentation
```

Run `node --test tests/NesEmulator.quickSave.test.cjs` to check quick saves.

## ⚖️ Legal Notice

This tool is for educational and research purposes only.

- ✅ This software is a **level editor tool** that does NOT include any game ROM or copyrighted resources
- ⚠️ Users must provide their own legally owned game ROM files
- 🚫 Piracy is NOT supported or encouraged
- 📜 Users must comply with copyright laws in their jurisdiction
- 🛡️ The author is NOT responsible for any legal consequences arising from the use of this tool

**モアイくん (Moai-kun)** is a trademark of Konami. This project is not affiliated with, endorsed by, or associated with Konami.

## 🤝 Contributing

Issues and Pull Requests are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 Roadmap

- [ ] Background processing of level data (if worth implementing in the future)

## 📄 License

This project is licensed under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- [JSNES](https://github.com/bfirsh/jsnes) - NES emulator core
- [Sortable](https://github.com/SortableJS/Sortable) - Sortable framework
- Konami - Original game developer
- All contributors and testers

## 📧 Contact

For questions or suggestions, please contact via:

- GitHub Issues: [Submit Issue](https://github.com/dasuxd/MoaikunMaker/issues)
- Email: aihidao@126.com
---

⭐ If this project helps you, please give it a Star!
