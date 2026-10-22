# Steam Updater

Credit for this app: Fubar · [Fubar's Hideout](https://discord.gg/FJa82GVfEa)

The workshop platform is Steam, and the upload path is Bohemia Interactive's DayZ Tools Publisher. This app only calls those. It does not include Steam or Bohemia's software, and the credit above is for this app alone.

AI-generated desktop tool, built to find out whether a **contributor** can update a DayZ Steam Workshop item.

The DayZ Publisher only shows items you authored. A contributor is on the workshop item, but is not the creator, so the official tool hides that item and will not upload it. This app asks the logged-in Steam account which DayZ workshop items it can see, including those contributor items, and tries a real upload through the same Publisher assemblies DayZ Tools ships.

A contributor push calls the publisher's full update, so the workshop title, description, tags, visibility, preview image, and files go together. Steam still decides whether that account is allowed to change the item. The account has to be logged into the Steam client, own DayZ, and already be a creator or contributor on that workshop item. This tool does not bypass those checks, and it does not build PBO files or BIS keys.

## Run the dev tool

Double-click `start-dev.bat`, or from this folder:

```bat
npm start
```

The first start builds the small 32-bit helper, then opens the Steam Updater window.

## Build the standalone exe

Double-click `build-exe.bat`, or:

```bat
npm run dist
```

That writes a portable app to `Release\Steam Updater.exe`. It is the program itself, not a setup installer. `Release\` is left out of git.

## What you need

- Windows
- [Node.js](https://nodejs.org/) with npm, for the dev tool and for building the exe
- The .NET SDK, to compile the helper (`net48`, 32-bit). The helper build looks for DayZ Tools in `C:\Program Files (x86)\Steam`. If yours is on another drive, set the `PublisherDir` environment variable to your `DayZ Tools\Bin\Publisher` folder before you build.
- DayZ Tools installed by Steam. The app looks for `DayZ Tools\Bin\Publisher` under your Steam libraries.
- Steam running as the account that should upload

## Local data

Mods, preview images, logs, and `settings.json` stay on this machine. They are gitignored. The first launch creates `settings.json` next to the app and a `MOD_DATA` folder for the library. `settings.example.json` shows the shape of that file. `theme` is `neon` or `light`.

`steamDir` is the folder that contains `steam.exe`. `publisherDir` is the DayZ Publisher folder that contains `SteamLayerWrap.dll`. Both are filled in from the Steam registry and your Steam libraries. Change them in Settings if the detected folders are wrong. A path you save is kept.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) for this app. Copyright Fubar.

You may use, copy, modify, and share this app. You may not sell it or monetize it.

Steam and the DayZ Tools Publisher stay under their own owners, Valve and Bohemia Interactive. Those programs are not covered by this license.
