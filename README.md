# Steam Updater

Credit for this app: Fubar & Psyern · [Fubar's Hideout](https://discord.gg/FJa82GVfEa)

A Windows app for DayZ modders: it packs and signs PBOs, keeps mod.cpp and meta.cpp, previews the workshop description the way Steam shows it, and pushes mods to the Steam Workshop, also as a **contributor** on an item someone else created.

The workshop platform is Steam, and the upload path is Bohemia Interactive's DayZ Tools Publisher. This app only calls those. It does not include Steam or Bohemia's software, and the credit above is for this app alone. Steam still decides whether an account may change an item: it has to be logged into the Steam client, own DayZ, and be a creator or contributor on that workshop item.

This repository only holds the downloads. The source code is kept private.

## Install the app

Download `Steam-Updater-Setup-<version>.exe` from the [latest release](https://github.com/FUBAR88/SteamUpdater/releases/latest) and run it. The setup installs for the current Windows user (no admin rights needed), lets you pick the folder, and adds a desktop and a Start menu shortcut. Uninstall it from Windows Settings > Apps. Your settings and mods are kept when you uninstall or update.

An installed copy keeps its data out of the program folder:

- `settings.json` in `%APPDATA%\Steam Updater`
- the `MOD_DATA` library in `Documents\Steam Updater\MOD_DATA` (change it in Settings)

### Small setup to share

[`Steam-Updater-Web-Setup.exe`](https://github.com/FUBAR88/SteamUpdater/releases/latest/download/Steam-Updater-Web-Setup.exe) is under 1 MB, small enough for Discord. It installs the same way as the full setup, but downloads the app (about 100 MB) from the newest release while it installs. It always installs the newest release, so a copy you shared once stays valid. The same file is in this repository as [`Release/nsis-web/Steam Updater Web Setup.exe`](Release/nsis-web/Steam%20Updater%20Web%20Setup.exe).

### Portable instead

[`Release/Steam Updater.exe`](Release/Steam%20Updater.exe) is the portable app, also attached to every release. Nothing to install. It creates `settings.json` and a `MOD_DATA` folder next to itself.

## Updates

The button with the version number in the title bar asks GitHub for the newest release. On every start it checks once and shows a green dot when a newer version is out. Click it to see the release notes, then **Update now**:

- **Installed copy**: downloads the new setup, closes the app, installs it into the same folder without questions, and starts it again.
- **Portable exe**: downloads the new `Steam Updater.exe`, replaces the running one once it has closed, and starts it.

The download is checked against its size and the SHA-256 checksum GitHub lists for it.

## Command line

An installed copy has `steam-updater-cli.cmd` next to `Steam Updater.exe`. It packs, signs, checks and pushes without the window, with the same templates and mods. `steam-updater-cli help` lists the commands.

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Copyright Fubar.

You may use, copy, modify, and share this app. You may not sell it or monetize it.

Steam and the DayZ Tools Publisher stay under their own owners, Valve and Bohemia Interactive. Those programs are not covered by this license.
