# RohanKar Launcher

A desktop game launcher for the classic PC game collection uploaded to [Archive.org](https://archive.org/search?query=uploader%3Arohanjackson071%40gmail.com) by **rohanjackson071**. Browse, install, and launch games from a single polished interface — no account required.

![RohanKar Launcher Screenshot](assets/screenshot.png)

---

## Features

### 🎮 Game Library
- Pulls the full game catalogue directly from Archive.org
- Search by title and sort by name, date archived, date published, or developer
- Installed games shown with a badge
- Option to show installed games first in the list

### 📦 Download & Install
- One-click download and automatic extraction (ZIP, 7z, RAR supported)
- Automatically unblocks downloaded files so games launch without permission errors
- Optionally deletes the archive after installation to save space
- Configurable download and install folder locations

### 🚀 Launching
- Automatically finds and launches the correct executable
- Smart exe picker for games with multiple launch options (e.g. DOSBox vs native)
- Set a default executable so future launches skip the picker
- Playtime tracking per game

### 🖼️ Game Detail Panel
- Hero banner image — pulled automatically from a `hero.png` bundled in the game's archive
- Archive.org description, year, download count, and file size
- Readme viewer (reads the readme packaged with the game)
- Archive.org user reviews tab
- Open install folder directly in Explorer

### 🔔 Updates
- Automatically checks for new releases on launch
- Notifies you when an update is available with a link to download it

---

## Installation

1. Go to the [latest release](https://github.com/Kilted-Kraken/-RohanKar-Launcher/releases/latest)
2. Download **RohanKar Launcher Setup x.x.x.exe**
3. Run the installer

> **Note:** Windows may show a SmartScreen warning on first run. Click **More info → Run anyway**. This is expected for unsigned installers from new publishers.

> **Upgrading from v1.0.7 or earlier?** The auto-updater in older versions does not work correctly. Please download and install **v1.0.8** manually from the link above. From v1.0.8 onwards, updates will be detected and linked to automatically.

---

## Requirements

- Windows 10 or later
- Internet connection (to browse and download games from Archive.org)

---

## Notes for Game Uploaders

To include a hero banner image for your game, place a file named `hero.png` in the root of your archive alongside the game folder and readme. The launcher will automatically display it as the banner when your game is selected.

Recommended hero image dimensions: **1920 × 620px**

---

## Tech Stack

- [Electron](https://www.electronjs.org/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [electron-updater](https://www.electron.build/auto-update)
- [Archive.org Advancedsearch API](https://archive.org/advancedsearch.php)

---

## License

This project is not affiliated with the Internet Archive. All games in the collection are property of their respective owners and are hosted publicly on Archive.org.
