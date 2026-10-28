# Steam Updater

Credit for this app: Fubar · [Fubar's Hideout](https://discord.gg/FJa82GVfEa)

The workshop platform is Steam, and the upload path is Bohemia Interactive's DayZ Tools Publisher. This app only calls those. It does not include Steam or Bohemia's software, and the credit above is for this app alone.

AI-generated desktop tool, built to find out whether a **contributor** can update a DayZ Steam Workshop item.

The DayZ Publisher only shows items you authored. A contributor is on the workshop item, but is not the creator, so the official tool hides that item and will not upload it. This app asks the logged-in Steam account which DayZ workshop items it can see, including those contributor items, and tries a real upload through the same Publisher assemblies DayZ Tools ships.

A contributor push calls the publisher's full update, so the workshop title, description, tags, visibility, preview image, and files go together. Steam still decides whether that account is allowed to change the item. The account has to be logged into the Steam client, own DayZ, and already be a creator or contributor on that workshop item. This tool does not bypass those checks, and it does not build PBO files or BIS keys.

## Just use the app

Download [`Release/Steam Updater.exe`](Release/Steam%20Updater.exe) and run it. It is a portable app, so there is nothing to install. It creates `settings.json` and a `MOD_DATA` folder next to itself.

## Run the dev tool

Double-click `start-dev.bat`, or from this folder:

```bat
npm install
npm start
```

`npm install` downloads Electron and the build tools into `node_modules` (only needed once). The first start builds the small 32-bit helper, then opens the Steam Updater window.

## Build the standalone exe

Double-click `build-exe.bat`, or:

```bat
npm run dist
```

That writes a portable app to `Release\Steam Updater.exe`. It is the program itself, not a setup installer. Only that exe is kept in git. The rest of `Release\` is build output.

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

Mods, preview images, logs, and `settings.json` stay on this machine. They are gitignored. The first launch creates `settings.json` next to the app and a `MOD_DATA` folder for the library. `settings.example.json` shows the shape of that file. `theme` is `neon` or `light`. `window` and `lastModId` are written by the app when it closes and when a mod is opened.

`steamDir` is the folder that contains `steam.exe`. `publisherDir` is the DayZ Publisher folder that contains `SteamLayerWrap.dll`. Both are filled in from the Steam registry and your Steam libraries. Change them in Settings if the detected folders are wrong. A path you save is kept.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) for this app. Copyright Fubar.

You may use, copy, modify, and share this app. You may not sell it or monetize it.

Steam and the DayZ Tools Publisher stay under their own owners, Valve and Bohemia Interactive. Those programs are not covered by this license.
