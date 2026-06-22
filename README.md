# 前紙 (Maegami)

> # 🇯🇵 [日本語の README はこちら →](README.ja.md)

*Bring your wallpaper back — to the front.*

When did we stop using wallpaper changers? Somewhere out there, your favorite wallpaper collection lies sleeping. The time has come to call them back — to the foreground!

![Maegami demo](docs/screenshot.webp)

In short, it's an app that does what those old wallpaper changers did, except right on top of your desktop, always in front. Sure, it makes things harder to see — but that's a trivial concern.

You can set the opacity, and you can keep the area around your cursor clear, so unless your work demands seeing the whole screen at all times, it's not as impractical as it sounds. It plays videos, too.



## Download

Download from the [latest release](https://github.com/Romly-Romly/maegami/releases/latest).

### Windows

- **Installer** — `Maegami Setup *.exe`
- **Portable** — `*-win.zip`

The app is not code-signed, so Windows SmartScreen will warn you on first launch. Click "More info", then "Run anyway" to start it. Use at your own risk.

### macOS

- **Disk image** — `Maegami-*.dmg` (Apple Silicon only)

Open the downloaded `.dmg` and drag `Maegami.app` into your Applications folder. Since it isn't signed, macOS won't let you open it — it just tells you to *move it to the Trash* (rude! 😭). Run the following command in Terminal to strip the quarantine attribute, and it will launch. Use at your own risk.

```sh
xattr -dr com.apple.quarantine /Applications/Maegami.app
```



## Usage

Point a layer at a folder containing your wallpapers, then set the display duration and presentation style to your liking. The app lives in the system tray.



## Settings

### Where settings are stored

Settings are saved as `settings.json` in the OS user-data directory.

| OS | Path |
|---|---|
| Windows | `%APPDATA%\maegami\settings.json` |
| macOS | `~/Library/Application Support/maegami/settings.json` |
| Linux | `~/.config/maegami/settings.json` |

On Windows, this settings folder is removed together with the app when you uninstall. macOS / Linux have no uninstaller, so if you want to clear your settings, delete the folder above manually.

### Removing auto-launch

If you enabled auto-launch, its registration remains even after uninstalling. Open the Registry Editor (`regedit`), go to `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run`, and delete the value pointing to the Maegami executable (`Maegami`).



## Requirements

| OS | Version |
|---|---|
| Windows | 10 / 11 (64-bit) |
| macOS | 11 (Big Sur) or later |

The versions listed follow what Electron 42 supports, but the app has only been tested on Windows 11.



## License

[GNU General Public License version 3](LICENSE) (GPL-3.0)

Copyright (C) 2026 Romly

This program is free software. Under the GPL-3, you may redistribute and modify it. If you distribute a modified version, you must release its source code under the same GPL-3.0 license.
