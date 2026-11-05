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
- Use the right toolbar to choose tiles/sprites/special items
- Left-click to place, right-click to delete
- Adjust scene, wide screen, and other properties

#### Bird and Flying Fish (Sprite 12)

- Scene 4 uses flying fish; other supported scenes use birds. Scenes 7 and 8 are not supported. They share the player's palette, patrol horizontally, and turn at obstacles. The player can stand on them and ride along.
- Landing on them from above makes them sink smoothly by half a tile (8 pixels), then rise back after about 90 frames. Jump and land again before they rise to sink another half tile and keep the full-tile drop. Each further pair of landings can lower them another tile. The bottom row permits only another half-tile drop; further landings cannot reach the next full row or postpone recovery. Standing still does not trigger more drops, and Up/Down no longer controls their height.
- They continue patrolling on their own; Left and Right only move the player. Jump or walk off the edge normally to leave. Vertical movement checks terrain and the rider's headroom, stopping at obstacles. A floor cancels any unfinished descent; repeated blocked landings cannot build up a drop to replay beyond a ledge.
- Hitting Tile 13 still makes ordinary monsters vulnerable. Birds and flying fish instead rise one tile, keep the new height, and fly away from the player's position at impact. They keep their direction if already heading away, at the same X, or equally distant around the looping map. Ascent respects ceilings and may leave the screen through the top. Fully departed objects disappear, then return to their birthplace after the native respawn delay and smoke animation. Spawning and defeated objects do not respond.
- The horizontal fright boost lasts only for the ascent. Reaching its target, stopping beneath a ceiling, or a landing that interrupts ascent immediately restores normal 0.5-pixel patrol. The shortest horizontal distance at impact sets speed: under 32 pixels gives 2 pixels per update, 32–63 gives 1.5, 64–95 gives 1, and 96 or more gives 0.5. Another impact recalculates speed and adds another tile of ascent; respawning clears fright.
- Contact is harmless. Headbutts, thrown stones, falling blocks or rocks, and explosions use the ordinary monster hit and death rules. They respawn at their birthplace after the native countdown. Initial spawns and respawns play the ordinary monster smoke animation before they start flying and can carry the player.

#### Portal prototype (Sprite 13)

- Place Sprite 13 in one 16×16 cell. Four Clu Clu Land frames and two contracted versions occupy reserved CHR `$C0–$FB`, preserving existing artwork.
- Portals normally draw in the background with no hardware sprites. A covering map tile or falling object enables two 8×16 overlay sprites until the background can return. Both paths use native scene colors and leave collision tiles unchanged. Normal frames advance every eight game updates; busy background updates are queued.
- Each portal retains one of the eight level object slots. Pause freezes its state and leaves background portals visible; covered overlays hide with native enemies. Several covered portals on one row can still exceed the NES eight-sprites-per-scanline limit.
- Exactly two portals with the same number form a pair. Click an existing portal to cycle numbers 1–4. Editor labels show A/B; a red ? means the group is not a valid pair. A starts as entry. Each group uses the same native palette scheme and a persistent numeral 1–4. Different groups use available scene colors; some colors are similar or only approximate between background and overlay, so numerals identify pairs reliably.
- Entry and exit swap every 300 game updates (about five seconds). The entry animates. The exit shows a stationary numbered rim with a transparent center, so cargo stays visible. During the final second the entry contracts, pauses, and expands while transport is disabled. Players automatically travel near the active entry center; staying at the exit allows a return after the next changeover.
- A successful transfer plays the last three poses of the original enemy disappearance at the entry over 16 game updates. When the player travels, the camera pans toward the exit during those updates.
- All 15 tiles, including walls and rescue heads, live enemies, projectiles and bombs can travel. Falling tiles transfer at a whole cell and resume support checks. Occupied exits wait. Fire statues and the level exit stay fixed. Leave a cell between a portal and the 2×2 exit. Overlapping portals from older levels take display priority.

### 3. Test Levels

- Click "🎮 Test Level" to run current level in emulator
- Click "🎮 Test ROM" to test the complete game
- All previews/downloads use expanded Mapper 2 ROMs (128 KiB PRG). The uploaded source stays intact.
- The experimental “Camera option in pause menu” is off by default. When disabled, narrow maps use a fixed view and wide maps wrap. When enabled, levels start with centered looping follow. Turn off `CENTER CAMERA` in Settings for a fixed narrow or bounded wide view; returning to the title resets it to ON. Wide maps always allow pause free-look. Narrow maps allow it in looping view. Horizontal bat wrapping follows the project option.
- Test Level automatically chooses `START` from the original `START / CONTINUE` password menu.
- With this option enabled, stage entry and returning from pause free-look also approach the target smoothly, at most 4 pixels per frame.
- Press Start to pause. `PAUSED` blinks in the center and `↑ MENU` stays at the top right. The side arrows disappear once you start looking around. Press Up for Settings and A to toggle the camera. ON is blue and OFF is red. Projects with the camera option disabled show `NO OPTIONS`. Press B to return to the paused map, then Start to resume. Gameplay and the timer stay frozen until the camera returns.
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
- Use an original Mapper 3 ROM or a compatible artwork variant as the base. Playtests and downloads build a fresh expanded ROM. Save a level pack to continue editing. If you only have an older exported ROM, use the older editor to export its levels first.

- **💾 Save Level** - Save changes to memory
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

```text
MoaikunMaker/
├── index.html
├── css/  (style, level-editor, level-library, playtest)
├── js/
│   ├── app.js
│   ├── app/       (ProjectLoader, LevelLibrary, LevelExchange, PlaytestController)
│   ├── project/   (Project, ProjectCache, LevelFile, GameSettings)
│   ├── level/     (Level, Enemy, LevelCodec, SceneTileRules, EditorGrid)
│   ├── rom/       (BaseRom, RomLayout, LevelLayout, buildRom, expandMapper, Asm6502)
│   │   └── patches/  (applyPatches, BirdFish, Portal, Camera, ViewModes, ...)
│   ├── graphics/  (GraphicsCatalog, SpritePatterns, SceneCompiler, ResourceManager)
│   ├── editor/    (LevelEditor, LevelCanvas, EditorToolbar)
│   ├── emulator/  (NesEmulator, MobileGameController)
│   ├── debug/     (RamRecorder)
│   ├── i18n.js
│   ├── lang/
│   └── lib/
└── tests/  (rom, project, editor, emulator, debug, helpers)
```

Run `node --test tests/emulator/NesEmulator.quickSave.test.cjs` to check quick saves.

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
