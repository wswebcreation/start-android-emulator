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
| `start-android-emulator --create "Pixel_API_{api}"` | Create an emulator with your own name, see [below](#several-emulators-with-your-own-names) |
| `start-android-emulator --delete Pixel_API_37_0` | Delete an emulator, see [below](#deleting-emulators) |

It waits until the emulator has booted, remembers the one you used last, and leaves the emulator running when the command ends.

### Pick the version, device and name from a list

```
start-android-emulator --create
```

Without a name you are asked which Android version, which device (Pixel 10, Pixel 9, Pixel 9 Pro, Pixel 8, Pixel 8 Pro, Pixel Tablet, Pixel Fold, or any other avdmanager hardware profile) and what the emulator is called: the suggested name, like `Pixel_9_API_37_0`, or your own. Then you can add another emulator, with the same Android version. What you already gave with `--api`, `--device` or `--skin` is not asked again. This needs a terminal.

### Several emulators with your own names

```
start-android-emulator --create "Test_1_API_{api}" --create "Test_2_API_{api}" --skin pixel_10 --yes
```

Each `--create` makes one emulator, and `{api}` becomes the Android version (`Test_1_API_37_0`). Use `--api 36` for another version, `--device` for another hardware profile (default `pixel_9`) and `--skin` for another device frame. Emulators that already exist are left alone. `--create` only sets up emulators, it does not start them: start one afterwards by its name. Add `--dry-run` to see the plan first. Because these are meant for Appium, `ANDROID_HOME`, `JAVA_HOME` and `PATH` are set as well.

### Deleting emulators

```
start-android-emulator --delete
```

Without a name you get a list of your emulators and select the ones to delete (space to select, enter to continue). With names it goes straight to the question:

```
start-android-emulator --delete Test_1_API_37_0 --delete Test_2_API_37_0
```

Each `--delete` removes one emulator and its data. You are asked to confirm first, `--yes` skips the question and `--dry-run` only shows what would be deleted. An emulator that is running is not deleted, stop it first. `--delete` cannot be combined with `--create` or an emulator to start.

### Keeping the SDK tidy and up to date

```
start-android-emulator --update
start-android-emulator --prune
```

`--update` installs the newer versions of what you use: the command-line tools, platform-tools, the emulator and the system images that your emulators run on. An emulator uses the system image in the SDK, so after an update it starts on the newer image and keeps its data and settings. Newer versions of system images that no emulator uses are skipped, they would only be a big download.

`--prune` lists the system images that no emulator uses, plus the platforms and sources of Android versions without an emulator, and removes the ones you select. Everything unused is selected, deselect what you want to keep. A platform is not needed to run an emulator, only to build apps for that Android version, and sources only to browse the Android code in an IDE. Build tools, the NDK and CMake are never touched. You are asked to confirm, `--yes` removes everything that is unused, and `--dry-run` shows what would go. Removed packages can be installed again by creating an emulator or running `--setup`.

Both need Java and the command-line tools, and cannot be combined with `--create`, `--delete` or an emulator to start. `--update --prune` does both.

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
  --create [name]    Create an emulator with this name, repeat it for more. {api} becomes the version,
                     like --create "Pixel_API_{api}" for Pixel_API_37_0.
                     Without a name you pick the version, the device and the name from a list
  --delete [name]    Delete the emulator with this name, repeat it for more.
                     Without a name you pick the emulators to delete from a list
  --update           Install the newer versions of the SDK packages in use, like the emulator and the system
                     images of your emulators (the emulators themselves keep their data)
  --prune            Remove the system images, platforms and sources no emulator uses, all selected
  --device <profile> Hardware profile for the emulators to create (default: pixel_9)
  --skin <skin>      Device frame for the emulators to create (default: the same as the device)
  --dry-run          Show what the setup would do, without changing anything

Other
  --check            Only show what is set up and what is missing, exits with 1 when something is missing
  -y, --yes          Answer yes to every question (also needed to set up without a terminal)
  -h, --help         Show this help
  -v, --version      Show the version

Examples
  Create an emulator by picking the version, device and name from a list:
    start-android-emulator --create
  Create an emulator with the newest Android version, then start it:
    start-android-emulator --create "Pixel_API_{api}"
    start-android-emulator Pixel_API_37_0
  Create two emulators for Android 36 with another device and frame, without questions:
    start-android-emulator --create "Test_1_API_{api}" --create "Test_2_API_{api}" --api 36 --device pixel_9 --skin pixel_10 --yes
  See what would happen without changing anything:
    start-android-emulator --create "Pixel_API_{api}" --dry-run
  Keep the SDK up to date, and remove what no emulator needs:
    start-android-emulator --update
    start-android-emulator --prune
  Delete emulators by picking them from a list:
    start-android-emulator --delete
  Delete emulators (asks first, --yes skips the question):
    start-android-emulator --delete Test_1_API_37_0 --delete Test_2_API_37_0
```

Your last emulator and your DNS choice are saved in `~/.config/start-android-emulator/config.json` (`%APPDATA%` on Windows).

## Use it from code

```ts
import { fetchVersions, namedTarget, resolveVersion, setupAndroid } from "start-android-emulator";

const { versions } = await fetchVersions();
const version = resolveVersion("37.0", versions);
await setupAndroid(namedTarget(version, ["Test_1_API_{api}", "Test_2_API_{api}"]));
```

To build the plan yourself, for example with your own AVD names and an extra step of your own, use `planAndroid` and `runPlan`. `configure` does what `--yes` and `--dry-run` do for the CLI.

```ts
import { configure, fetchVersions, inspect, namedTarget, planAndroid, resolveVersion, runPlan, type Step } from "start-android-emulator";

configure({ yes: false, dryRun: false });
const { versions } = await fetchVersions();
const version = resolveVersion("37.0", versions);
const steps = planAndroid(await inspect(), namedTarget(version, [
  { name: "Workshop_1_Pixel_10_API_{api}", device: { profile: "pixel_9", skin: "pixel_10" } },
  { name: "Workshop_2_Pixel_10_API_{api}", device: { profile: "pixel_9", skin: "pixel_10" } },
]));
const myStep: Step = { id: "demo-app", title: "Download the demo app", description: "The app used in the workshop", done: false, apply: async () => true };
await runPlan("This is what we need for the workshop:", [...steps, myStep]);
```

Every `Step` needs an `id`. Use `dry(message)` in your own steps to print what would have been done in a dry run.

`main(argv)` runs the whole CLI and returns the exit code, for example `await main(["--create", "Test_1_API_{api}", "--create", "Test_2_API_{api}", "--yes"])`.

## Upgrading from 3.x

The module is now written in TypeScript and needs Node.js 24. It no longer needs `ANDROID_HOME` to be set beforehand, because it finds the SDK itself.

## Development

```
npm install
npm run build:watch   # build on every change
npm test              # or npm run test:watch
npm run typecheck
```

## Releasing

Releases are made by GitHub Actions ([release.yml](.github/workflows/release.yml)) and published to npm with trusted publishing, so no npm token is needed.

1. Merge your changes into `main` and make sure the tests are green.
2. On GitHub, go to Actions, Release, Run workflow. Choose `main`, the release type (`patch`, `minor` or `major`) and the npm tag (`latest`, or `next` for a test version).
3. The workflow runs the tests, bumps the version, publishes to npm with provenance, pushes the version commit and the `vX.Y.Z` tag, and creates the GitHub release with generated release notes. Only the owner of the repository can run it.

Give every pull request one of the `PR: …` labels (Breaking Change, New Feature, Bug Fix, Polish, Docs, Internal) to get it under the right heading in the release notes, see [.github/release.yml](.github/release.yml). `skip-changelog` leaves a pull request out.

One-time setup on npmjs.com: package settings, Trusted Publisher, GitHub Actions, repository `wswebcreation/start-android-emulator`, workflow `release.yml`, with "Allow npm publish" ticked.

## License

MIT
