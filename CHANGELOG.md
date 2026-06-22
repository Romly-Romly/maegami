# Changelog

> # 🇯🇵 [日本語の変更履歴はこちら →](CHANGELOG.ja.md)

## [1.4.5] - 2026-06-22

- While paused, the overlay is now hidden so it no longer interferes with selecting a window for screenshots.
- Reworked the macOS icon using Icon Composer.
- Added instructions to the README for getting the app to launch on macOS.
- Fixed a bug where shadows could be left behind when the "Avoid cursor" setting was enabled.



## [1.4.0] - 2026-06-21

- Added an **Avoid cursor** setting. When the wallpaper gets in the way, images can slide aside to get out of your way.
- Added macOS support. The build is unsigned, so you will see a warning.
- Other minor fixes.


## [1.3.0] - 2026-06-17

### Added
- A "depth" direction for the slow drift option (front-to-back / back-to-front), combining fade and scaling to convey approaching and receding motion.
- Icons for some items in the settings screen and the tray menu.
- The "Folders to display" setting now scans subfolders recursively, up to 3 levels deep.

### Changed
- Adjusted some configurable ranges, hint wording, and so on.
- Other minor fixes.

## [1.2.0] - 2026-06-16

### Added
- Multilingual support (Japanese / English) with a switch to change the display language.
- A trail feature that keeps the cut-out areas traced by the mouse visible for a while.
- A "Next" item in the tray menu, letting you advance images manually during playback.
- A "slow drift" option for randomly placed images.
- Randomly placed images now gently avoid the mouse cursor when they appear.

### Changed
- Trimmed the bundled Electron locales to Japanese and English to make the distribution lighter.

## [1.0.0] - 2026-06-15

Initial release.
