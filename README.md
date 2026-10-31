# Steam Updater

Credit for this app: Fubar · [Fubar's Hideout](https://discord.gg/FJa82GVfEa)

The workshop platform is Steam, and the upload path is Bohemia Interactive's DayZ Tools Publisher. This app only calls those. It does not include Steam or Bohemia's software, and the credit above is for this app alone.

AI-generated desktop tool, built to find out whether a **contributor** can update a DayZ Steam Workshop item.

The DayZ Publisher only shows items you authored. A contributor is on the workshop item, but is not the creator, so the official tool hides that item and will not upload it. This app asks the logged-in Steam account which DayZ workshop items it can see, including those contributor items, and tries a real upload through the same Publisher assemblies DayZ Tools ships.

A contributor push calls the publisher's full update, so the workshop title, description, tags, visibility, preview image, and files go together. Steam still decides whether that account is allowed to change the item. The account has to be logged into the Steam client, own DayZ, and already be a creator or contributor on that workshop item. This tool does not bypass those checks, and it does not build PBO files or BIS keys.

## Install the app

Download `Steam Updater Setup <version>.exe` from the [latest release](https://github.com/FUBAR88/SteamUpdater/releases/latest) and run it. The setup installs for the current Windows user (no admin rights needed), lets you pick the folder, and adds a desktop and a Start menu shortcut. Uninstall it from Windows Settings > Apps. Your settings and mods are kept when you uninstall or update.

An installed copy keeps its data out of the program folder:

- `settings.json` in `%APPDATA%\Steam Updater`
- the `MOD_DATA` library in `Documents\Steam Updater\MOD_DATA` (change it in Settings)

### Portable instead

[`Release/Steam Updater.exe`](Release/Steam%20Updater.exe) is the portable app, also attached to every release. Nothing to install. It creates `settings.json` and a `MOD_DATA` folder next to itself.

## Updates

The button with the version number in the title bar asks GitHub for the newest release of this repository. On every start it checks once and shows a green dot when a newer version is out. Click it to see the release notes, then **Update now**:

- **Installed copy**: downloads the new setup, closes the app, installs it into the same folder without questions, and starts it again.
- **Portable exe**: downloads the new `Steam Updater.exe`, replaces the running one once it has closed, and starts it.

The download is checked against its size and the SHA-256 checksum GitHub lists for it. **Release page** opens the release on GitHub. The dev tool only shows whether a new version exists, it updates with `git pull`.

## Run the dev tool

Double-click `start-dev.bat`, or from this folder:

```bat
npm install
npm start
```

`npm install` downloads Electron and the build tools into `node_modules` (only needed once). The first start builds the small 32-bit helper, then opens the Steam Updater window.

## Build the setup and the exe

Double-click `build-exe.bat`, or:

```bat
npm run dist
```

That writes two files to `Release\`:

- `Steam Updater Setup <version>.exe`, the installer
- `Steam Updater.exe`, the portable app

Only the portable exe is kept in git. The setup is too big for a git file on GitHub and goes into the releases. The rest of `Release\` is build output.

## Publish a release

1. Raise `version` in `package.json` (for example `1.0.0` to `1.1.0`). The update button compares this number with the newest release.
2. Create a GitHub token with write access to the contents of `FUBAR88/SteamUpdater` and set it in the console: `set GH_TOKEN=<token>`.
3. Run `release.bat` (or `npm run release`).

It builds both files and publishes them as release `v<version>` on GitHub, with the setup, the portable exe, `latest.yml` and the blockmap attached. Write the release notes on the release page afterwards, the update dialog shows them. The release has to be published, not a draft or pre-release, to count as the latest.

The build needs DayZ Tools for the helper (see below), so releases are built on a machine that has them, not by GitHub Actions.

## What you need

- Windows
- [Node.js](https://nodejs.org/) with npm, for the dev tool and for building the exe
- The .NET SDK, to compile the helper (`net48`, 32-bit). The helper build looks for DayZ Tools in `C:\Program Files (x86)\Steam`. If yours is on another drive, set the `PublisherDir` environment variable to your `DayZ Tools\Bin\Publisher` folder before you build.
- DayZ Tools installed by Steam. The app looks for `DayZ Tools\Bin\Publisher` under your Steam libraries.
- Steam running as the account that should upload

## Content folder and signature check

Every mod has a **Content folder** field in the Workshop panel. Paste a path (quotes from Explorer's "Copy as path" are removed), type one and press Enter, pick it with the folder button, or drop the folder on the field. A dropped file counts as the folder it is in. The mod folder (`@MyMod`), its `addons` folder, or any folder with `.pbo` files works. The arrow button opens the folder in Explorer.

The shield button checks every `.pbo`:

- **Signed**: a `.bisign` next to it, made with a key that is in the mod's `keys\` folder
- **Not signed**: no `.bisign`
- **Wrong key**: the `.bisign` names a key that is not in `keys\`
- **Key differs**: `keys\` has a `.bikey` with the same name, but it is a different key. This happens when a key is made again under the old name.
- **No .bikey**: there is no `.bikey` in `keys\`
- **Outdated**: the `.pbo` is newer than its `.bisign`, so it was rebuilt after signing

It also looks at `keys\` itself: more than one `.bikey`, or a `.bikey` that signs none of the PBOs, is reported.

The check compares the public key stored in each `.bisign` with the one in each `.bikey`. It does not recompute the signature hashes. Push runs the check again and asks before it uploads when a PBO is not signed correctly or `keys\` needs a look.

## Reading mod.cpp and meta.cpp

Save writes the mod.cpp fields into `mod.cpp` and a fresh `meta.cpp` in the content folder. The arrows next to the **mod.cpp** heading go the other way: they read both files from the content folder (or the mod folder above an `addons` folder) and put their values into the form.

- Every mod.cpp field takes the value from the file. A field the file does not have becomes empty, so the form matches the file.
- Keys match in any case (`authorId` counts as `authorID`), `\"` and `""` inside a value are read as a quote, and image paths keep their backslashes.
- `meta.cpp` fills **name** only when mod.cpp has none, and the published file id only when the mod has none yet. A different id in `meta.cpp` is reported in the log and not taken over.

The values land in the app's library. The files themselves are not changed until you press Save.

## Packing

The **Pack** tab in the title bar packs your source folders into PBOs and writes them straight into a mod folder, so nothing has to be copied into `MOD_DATA` by hand. It uses AddonBuilder from DayZ Tools.

- **Templates** (left): a template holds any number of source folders, each becomes one PBO named after its folder. `RevolutionZA` and `Deadmans-Echo` come built in and stay as they are. **Save as own** copies one with your own name and custom text, which you can then change freely. Templates are stored in `MOD_DATA\pack_templates.json`.
- **Config** (middle): the pack folders (tick the ones the Pack button builds, or pack one row on its own), the prefix (empty: from `$PBOPREFIX$` or `$PREFIX$` in the folder, else the folder name), the files AddonBuilder copies without binarizing, an exclusion list file, extra exclusion patterns, and Binarize (off: pack only).
- **Destination** (right): any folder, or a mod from the updater list, which uses its content folder. The PBOs go into its addons folder, the public key into its keys folder (both names can be changed, e.g. `Addons` and `key`). With a private key every PBO is signed. The private key must not be inside the destination, and a `.biprivatekey` is never packed.

After a pack, the same signature check as in the Workshop panel runs on the destination. **Open in Workshop** jumps to the linked mod, ready to push.

Settings has two new fields: **AddonBuilder** (empty: found next to DayZ Tools) and **Files template**, the default list of files to copy directly for every template that leaves its own list empty.

AddonBuilder 1.0.240639 crashes on its own `-exclude` option, so exclusions are applied by the app: each source is copied into a temporary folder without the excluded files, and that copy is packed. AddonBuilder still applies the `exclude.lst` of DayZ Tools on top. A pack only counts when the PBO was really rewritten, because AddonBuilder can report success after a crash.

## Pushing

- **Check before push**: a contributor push replaces the whole workshop page. Before it starts, the app reads the page from Steam and shows what changes: title, visibility, tags, preview image, and the description line by line. **Push** goes on, **Use workshop text** copies the page from Steam into the form and stops, **Cancel** stops. Steam only shows public items to this lookup. For private and friends-only items the dialog lists what the push will set.
- **Push marked**: tick mods in the list and press **Push marked**. All questions come first, then the mods are pushed one after another. Mods that finish lose their tick, failed ones keep it.
- **Last push**: each mod in the list shows when it was last pushed, with a green dot when it finished and a red one when it failed. Hover it for the time and the message.
- **Change note**: left empty, the push writes the `mod.cpp` version and today's date. The calendar button puts that line into the field. After a push the note moves to **Earlier notes**, from where it can be picked again.

## Keyboard

| Keys | Does |
| --- | --- |
| Ctrl+S | Save |
| Ctrl+Enter | Push the open mod |
| Ctrl+F | Search the mod list |
| Esc | Close a dialog |

The window opens where it was closed, with the mod that was open last.

## Local data

Mods, preview images, logs, and `settings.json` stay on this machine. They are gitignored. The first launch creates `settings.json` and a `MOD_DATA` folder for the library: next to the portable exe and the dev tool, in `%APPDATA%\Steam Updater` and `Documents\Steam Updater` for an installed copy. `settings.example.json` shows the shape of that file. `theme` is `neon` or `light`. `window` and `lastModId` are written by the app when it closes and when a mod is opened.

`steamDir` is the folder that contains `steam.exe`. `publisherDir` is the DayZ Publisher folder that contains `SteamLayerWrap.dll`. Both are filled in from the Steam registry and your Steam libraries. Change them in Settings if the detected folders are wrong. A path you save is kept.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) for this app. Copyright Fubar.

You may use, copy, modify, and share this app. You may not sell it or monetize it.

Steam and the DayZ Tools Publisher stay under their own owners, Valve and Bohemia Interactive. Those programs are not covered by this license.
