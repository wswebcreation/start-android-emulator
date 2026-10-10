# start-android-emulator

Start an Android emulator from your terminal. No Java or Android SDK yet? It sets them up for you.

```
npm install -g start-android-emulator
start-android-emulator
```

Requires Node.js 24 or newer. Works on macOS, Linux and Windows.

## What can it do?

| Command | What it does |
| --- | --- |
| `start-android-emulator` | Pick an emulator from the list, and start it |
| `start-android-emulator Pixel_9_API_37_0` | Start an emulator by name |
| `start-android-emulator --check` | See what is set up and what is missing, and which emulators exist |
| `start-android-emulator --setup` | Install what is missing |

It waits until the emulator has booted, remembers the one you used last, and leaves the emulator running when the command ends.

### Several emulators with your own names

```
start-android-emulator --create "Test_1_API_{api}" --create "Test_2_API_{api}" --skin pixel_10 --yes
```

Each `--create` makes one emulator, and `{api}` becomes the Android version (`Test_1_API_37_0`). Use `--api 36` for another version. Emulators that already exist are left alone. Because these are meant for Appium, `ANDROID_HOME`, `JAVA_HOME` and `PATH` are set as well.

### When something is missing

When Java, the Android command-line tools, the SDK packages or an emulator are missing, you see a plan of what is needed and you choose to do everything, pick steps, or nothing. It can:

- install Temurin 21 into `~/.jdks/temurin-21`
- install the Android command-line tools, the platform tools, the emulator and a system image
- create an emulator (default `Pixel_9_API_37_0`)
- set `ANDROID_HOME`, `JAVA_HOME` and `PATH` for new terminals

Downloads can be resumed, and a proxy from `HTTPS_PROXY` / `HTTP_PROXY` is used.

## Options

```
Start options
  --wipe-data        Delete all user data of the emulator before starting
  --cold-boot        Start without using or saving a snapshot
  --dns <ip>         DNS server for the emulator (default: 8.8.8.8, needed when the emulator has no wifi)
  --no-dns           Use the DNS of your computer
  --verbose          Show the output of the emulator while it boots
  --no-wait          Start the emulator and return, without waiting for it to boot

Setup
  --setup            Show the setup plan, also when nothing is missing
  --no-setup         Never offer to install anything, only report what is missing
  --api <level>      Android version to create an emulator for, like 36 or 37.0 (default: the newest)
  --create <name>    Create an emulator with this name, repeat it for more. {api} becomes the version,
                     like --create "Pixel_API_{api}" for Pixel_API_37_0
  --device <profile> Hardware profile for the emulators to create (default: pixel_9)
  --skin <skin>      Device frame for the emulators to create (default: the same as the device)
  --dry-run          Show what the setup would do, without changing anything

Other
  --check            Only show what is set up and what is missing, exits with 1 when something is missing
  -y, --yes          Answer yes to every question (also needed to set up without a terminal)
  -h, --help         Show this help
  -v, --version      Show the version
```

Your last emulator and your DNS choice are saved in `~/.config/start-android-emulator/config.json` (`%APPDATA%` on Windows).

## Use it from code

```ts
import { fetchVersions, namedTarget, resolveVersion, setupAndroid } from "start-android-emulator";

const { versions } = await fetchVersions();
const version = resolveVersion("37.0", versions);
await setupAndroid(namedTarget(version, ["Test_1_API_{api}", "Test_2_API_{api}"]));
```

`main(argv)` runs the whole CLI and returns the exit code, for example `await main(["--create", "Test_1_API_{api}", "--create", "Test_2_API_{api}", "--yes"])`.

## Upgrading from 3.x

The module is now written in TypeScript and needs Node.js 24. It no longer needs `ANDROID_HOME` to be set beforehand, because it finds the SDK itself.

## License

MIT
