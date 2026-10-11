import { checkbox, confirm, input, select } from "@inquirer/prompts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HELP, UsageError, hasStartOptions, parseOptions, type Options } from "./args.ts";
import { DEFAULT_DNS, findRunning, followLog, launchEmulator, waitForBoot } from "./android/emulator.ts";
import { type Inspection, inspect } from "./android/inspect.ts";
import { acceptLicenses, adbBinary, installPackages, listInstalledPackages, listUpdates, packageFolder, sdkManagerMessages, uninstallPackage } from "./android/sdk.ts";
import { splitUpdates, unusedPackages } from "./android/maintain.ts";
import { DEFAULT_DEVICE, avdImage, deleteAvd, type DeviceProfile } from "./android/avd.ts";
import { defaultTarget, namedTarget, planAndroid } from "./android/setup.ts";
import { askNewEmulators, type NewEmulator } from "./wizard.ts";
import { printAbout, printBanner } from "./banner.ts";
import { type AndroidVersion, fetchVersions, resolveVersion } from "./android/versions.ts";
import { readConfig, writeConfig } from "./config.ts";
import { relaunchWithProxy } from "./network.ts";
import { blocking, runPlan, showPlan, type Step } from "./plan.ts";
import { bold, cyan, dim, fail, info, ok, settings, startSpinner, todo, warn } from "./ui.ts";

/** Everything the flow reaches out to, so a test can replace the parts it does not want to run for real. */
export const realDeps = {
  printBanner,
  printAbout,
  inspect,
  fetchVersions,
  planAndroid,
  runPlan,
  findRunning,
  startSpinner,
  launchEmulator,
  waitForBoot,
  followLog,
  adbBinary,
  readConfig,
  writeConfig,
  relaunchWithProxy,
  deleteAvd,
  avdImage,
  listUpdates,
  listInstalledPackages,
  acceptLicenses,
  installPackages,
  uninstallPackage,
  confirm: confirm as (options: unknown) => Promise<boolean>,
  input: input as (options: unknown) => Promise<string>,
  select: select as (options: unknown) => Promise<string>,
  checkbox: checkbox as (options: unknown) => Promise<string[]>,
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
};
export type Deps = typeof realDeps;

export const EXIT = { ok: 0, failed: 1, usage: 2, cancelled: 130 } as const;

const packageVersion = (): string => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "";
  }
};

/** The whole command. Returns the exit code, nothing in here exits the process. */
export async function main(argv: string[], overrides: Partial<Deps> = {}): Promise<number> {
  const deps: Deps = { ...realDeps, ...overrides };
  try {
    const opts = parseOptions(argv);
    if (opts.version) return print(packageVersion());
    if (opts.help) {
      deps.printBanner(packageVersion());
      return print(HELP);
    }

    const relaunched = deps.relaunchWithProxy();
    if (relaunched !== null) return relaunched;

    settings.yes = opts.yes;
    settings.dryRun = opts.dryRun;
    return await run(opts, deps);
  } catch (e) {
    if (e instanceof UsageError) {
      fail(e.message);
      return EXIT.usage;
    }
    if ((e as Error).name === "ExitPromptError") {
      console.log("\nCancelled.");
      return EXIT.cancelled;
    }
    throw e;
  }
}

const print = (text: string) => {
  console.log(text.trimEnd());
  return EXIT.ok;
};

async function run(opts: Options, deps: Deps): Promise<number> {
  deps.printBanner(packageVersion());
  deps.printAbout();

  let state = await busy(deps, lookingText(opts), deps.inspect);
  if (opts.delete.length > 0) return deleteEmulators(opts, state, deps);
  if (opts.update || opts.prune) return maintainSdk(opts, state, deps);
  let asked: NewEmulator[] | null = null;
  if (opts.create[0] === "") ({ opts, asked } = await askForEmulators(opts, deps));

  const wantsPlan = opts.setup === true || opts.create.length > 0 || opts.dryRun;
  const canStart = state.emulatorReady && state.avds.length > 0;

  if (wantsPlan || opts.check || !canStart) {
    const version = await chooseVersion(opts, state, deps);
    const target = asked ? namedTarget(version, asked) : opts.create.length > 0 ? namedTarget(version, opts.create, deviceFor(opts)) : defaultTarget(version);
    const steps = deps.planAndroid(state, target);

    if (opts.check) return check(state, steps);

    if (wantsPlan || blocking(steps).length > 0) {
      const finished = await setup(opts, steps, deps, wantsPlan);
      if (finished !== null) return finished;
      state = await busy(deps, "Checking your setup again...", deps.inspect);
    }
  } else {
    ok(`Android SDK ${dim(state.sdk)}`);
    ok(`${state.avds.length} emulator${state.avds.length === 1 ? "" : "s"} found`);
  }

  return start(opts, state, deps);
}

/** Show a spinner with what we are doing while we wait for something, and take it away when it is done. */
async function busy<T>(deps: Deps, text: string, work: () => Promise<T>): Promise<T> {
  const stop = deps.startSpinner(text);
  try {
    return await work();
  } finally {
    stop();
  }
}

/** What we say while we look at the machine, depending on what was asked. */
const lookingText = (opts: Options) =>
  opts.delete.length > 0 ? "Looking up your emulators..." : opts.update || opts.prune ? "Checking your Android SDK..." : opts.check ? "Checking what is set up..." : "Checking your setup...";

/** --update and --prune: keep the SDK up to date and free of what no emulator needs. */
async function maintainSdk(opts: Options, state: Inspection, deps: Deps): Promise<number> {
  if (!state.java || !state.toolsReady) {
    fail("Maintaining the SDK needs Java and the command-line tools. Run start-android-emulator --setup first.");
    return EXIT.failed;
  }
  const images = state.avds.map((name) => ({ name, image: deps.avdImage(name) }));
  const unreadable = images.filter((entry) => entry.image === null).map((entry) => entry.name);
  if (unreadable.length > 0) {
    fail(`Could not read which system image ${unreadable.join(", ")} uses, so we cannot tell what is safe to change.`);
    return EXIT.failed;
  }
  const used = images.map((entry) => entry.image!);

  if (opts.update) {
    const code = await updateSdk(opts, state, deps, images as { name: string; image: string }[]);
    if (code !== EXIT.ok || !opts.prune) return code;
  }
  return opts.prune ? pruneSdk(opts, state, deps, used) : EXIT.ok;
}

async function updateSdk(opts: Options, state: Inspection, deps: Deps, images: { name: string; image: string }[]): Promise<number> {
  const java = state.java!.home;
  const updates = await busy(deps, "Looking for updates...", () => deps.listUpdates(state.sdk, java));
  if (updates === null) {
    fail("Could not ask for updates. Are you online?");
    return EXIT.failed;
  }
  const { apply, skipped } = splitUpdates(updates, images.map((entry) => entry.image));
  if (skipped.length > 0) info(`${skipped.length} newer system image${skipped.length === 1 ? "" : "s"} skipped because no emulator uses ${skipped.length === 1 ? "it" : "them"}: ${skipped.map((u) => u.id.split(";")[1]).join(", ")}. Remove them with --prune.`);
  if (apply.length === 0) {
    ok("Everything in use is up to date");
    return EXIT.ok;
  }

  console.log("\nThese can be updated:\n");
  for (const update of apply) todo(`${bold(update.id)} ${dim(`${update.installed} → ${update.available}`)}`);
  if (opts.dryRun) {
    info("[dry run] nothing was changed");
    return EXIT.ok;
  }
  if (deps.interactive && !opts.yes && !(await deps.confirm({ message: `Update ${apply.length} package${apply.length === 1 ? "" : "s"} (this accepts the Android SDK licenses)?`, default: true }))) {
    console.log("Nothing updated.");
    return EXIT.ok;
  }

  console.log();
  if (!deps.acceptLicenses(state.sdk, java) || !deps.installPackages(state.sdk, java, apply.map((u) => u.id))) {
    fail("Updating failed, see the output above");
    return EXIT.failed;
  }
  ok("SDK updated");
  const refreshed = images.filter((entry) => apply.some((u) => u.id === entry.image)).map((entry) => entry.name);
  if (refreshed.length > 0) ok(`${refreshed.join(", ")} now use${refreshed.length === 1 ? "s" : ""} the newer system image, their data is kept`);
  return EXIT.ok;
}

async function pruneSdk(opts: Options, state: Inspection, deps: Deps, used: string[]): Promise<number> {
  const java = state.java!.home;
  const installed = await busy(deps, "Looking for SDK packages no emulator uses...", () => deps.listInstalledPackages(state.sdk, java));
  if (installed === null) {
    fail("Could not read the installed SDK packages.");
    return EXIT.failed;
  }
  const unused = unusedPackages(installed, used);
  if (unused.length === 0) {
    ok("Nothing to remove, every system image and platform belongs to an emulator");
    return EXIT.ok;
  }

  // Everything no emulator needs is selected, you deselect what you want to keep
  let ids = unused.map((p) => p.id);
  if (deps.interactive && !opts.yes && !opts.dryRun) {
    ids = await deps.checkbox({
      message: "No emulator uses these. Which do you want to remove? (space to select, enter to continue)",
      choices: unused.map((p) => ({ value: p.id, name: p.kind === "image" ? p.id : `${p.id} ${dim(p.kind === "platform" ? "(not needed to run emulators, only to build apps for it)" : "(source code of Android, only for browsing in an IDE)")}`, checked: true })),
    });
  } else if (!deps.interactive && !opts.yes && !opts.dryRun) {
    throw new UsageError("--prune asks which packages to remove, and there is no terminal to ask in. Add --yes to remove everything that is unused, or --dry-run to see them.");
  }
  if (ids.length === 0) {
    console.log("Nothing removed.");
    return EXIT.ok;
  }

  if (opts.dryRun) {
    for (const id of ids) info(`would remove ${id}`);
    return EXIT.ok;
  }
  if (deps.interactive && !opts.yes && !(await deps.confirm({ message: `Remove ${ids.length} package${ids.length === 1 ? "" : "s"}? You can install them again later.`, default: false }))) {
    console.log("Nothing removed.");
    return EXIT.ok;
  }
  const failed: string[] = [];
  for (const id of ids) {
    const { output, exitCode } = await busy(deps, `Removing ${id}...`, () => deps.uninstallPackage(state.sdk, java, id));
    if (exitCode === 0) {
      ok(`Removed ${id}`);
      continue;
    }
    failed.push(id);
    fail(`Removing ${id} failed`);
    for (const line of sdkManagerMessages(output)) info(line);
    const folder = packageFolder(state.sdk, id);
    if (existsSync(join(folder, ".installer"))) info(`An earlier install of this package was never finished, so sdkmanager will not remove it. Delete the folder yourself: ${folder}`);
  }
  if (failed.length > 0) return EXIT.failed;
  return EXIT.ok;
}

/** A bare --create: ask for the version once and the device and name of each emulator, and go on as if the version was given on the command line. */
async function askForEmulators(opts: Options, deps: Deps): Promise<{ opts: Options; asked: NewEmulator[] }> {
  if (!deps.interactive) throw new UsageError("--create without a name asks questions, and there is no terminal to ask in. Give a name: --create <name>");
  const { versions, source } = await busy(deps, "Looking up the Android versions...", deps.fetchVersions);
  if (source === "built-in") warn("Could not read the list of Android versions from Google, using the built-in list.");
  const { version, emulators } = await askNewEmulators(versions, opts, deps);
  return { opts: { ...opts, api: version.api, create: emulators.map((e) => e.name) }, asked: emulators };
}

/** --delete: remove the named emulators. Asks first, unless --yes or there is no terminal to ask in. */
async function deleteEmulators(opts: Options, state: Inspection, deps: Deps): Promise<number> {
  if (opts.delete[0] === "") {
    if (!deps.interactive) throw new UsageError("--delete without a name asks which emulators, and there is no terminal to ask in. Give the names: --delete <name>");
    if (state.avds.length === 0) {
      fail("There are no emulators to delete.");
      return EXIT.failed;
    }
    const picked = await deps.checkbox({ message: "Which emulators do you want to delete? (space to select, enter to continue)", choices: state.avds.map((value) => ({ value, name: value })) });
    if (picked.length === 0) {
      console.log("Nothing deleted.");
      return EXIT.ok;
    }
    opts = { ...opts, delete: picked };
  }
  const missing = opts.delete.filter((name) => !state.avds.includes(name));
  if (missing.length > 0) {
    fail(`There is no emulator called ${missing.map((name) => `"${name}"`).join(", ")}. The emulators on this machine: ${state.avds.join(", ") || "none"}`);
    return EXIT.failed;
  }
  const names = [...new Set(opts.delete)];

  if (opts.check) {
    info(`Would delete ${names.join(", ")}`);
    return EXIT.ok;
  }
  if (opts.dryRun) {
    for (const name of names) info(`would delete ${name}`);
    return EXIT.ok;
  }
  if (!state.java || !state.toolsReady) {
    fail("Deleting emulators needs Java and the command-line tools. Run start-android-emulator --setup first.");
    return EXIT.failed;
  }

  const adb = deps.adbBinary(state.sdk);
  const running = adb ? names.filter((name) => deps.findRunning(adb, name)) : [];
  if (running.length > 0) {
    fail(`${running.join(", ")} ${running.length === 1 ? "is" : "are"} running. Stop ${running.length === 1 ? "it" : "them"} first.`);
    return EXIT.failed;
  }

  if (deps.interactive && !opts.yes) {
    const sure = await deps.confirm({ message: `Delete ${names.join(", ")}? This removes the emulator and all its data.`, default: false });
    if (!sure) {
      console.log("Nothing deleted.");
      return EXIT.ok;
    }
  }

  let allDeleted = true;
  for (const name of names) {
    const { output, exitCode } = await busy(deps, `Deleting ${name}...`, () => deps.deleteAvd(state.sdk, state.java!.home, name));
    if (exitCode === 0) {
      ok(`Deleted ${name}`);
    } else {
      fail(`Deleting ${name} failed`);
      info(output);
      allDeleted = false;
    }
  }
  return allDeleted ? EXIT.ok : EXIT.failed;
}

const deviceFor = ({ device, skin }: Options): DeviceProfile => ({
  profile: device ?? DEFAULT_DEVICE.profile,
  skin: skin ?? device ?? DEFAULT_DEVICE.skin,
});

/** The Android version for the emulator we might create: --api, the newest, or a pick from the list. */
async function chooseVersion(opts: Options, state: Inspection, deps: Deps): Promise<AndroidVersion> {
  const { versions, source } = await busy(deps, "Looking up the Android versions...", deps.fetchVersions);
  if (source === "built-in") warn("Could not read the list of Android versions from Google, using the built-in list.");

  if (opts.api) return pickVersion(opts.api, versions);

  const newest = versions[0]!;
  const willCreate = state.avds.length === 0 && opts.create.length === 0 && !opts.check && !opts.dryRun;
  if (!willCreate || !deps.interactive || opts.yes) return newest;

  const api = await deps.select({
    message: "Which Android version do you want for the emulator?",
    choices: versions.filter((v) => Number.parseFloat(v.api) >= 30).map((v) => ({ value: v.api, name: v.label })),
    default: newest.api,
  });
  return pickVersion(api, versions);
}

const pickVersion = (requested: string, versions: AndroidVersion[]): AndroidVersion => {
  try {
    return resolveVersion(requested, versions);
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
};

function check(state: Inspection, steps: Step[]): number {
  showPlan("This is what we found:", steps);
  if (state.avds.length > 0) {
    console.log("\nEmulators:");
    for (const avd of state.avds) info(`- ${avd}`);
  }
  const missing = blocking(steps);
  console.log(missing.length > 0 ? "\nSomething is missing. Run start-android-emulator --setup to fix it." : "\nEverything is set up.");
  return missing.length > 0 ? EXIT.failed : EXIT.ok;
}

/** Offer (or, with --setup, run) the setup. Returns an exit code when we are done, null when we can go on to start an emulator. */
async function setup(opts: Options, steps: Step[], deps: Deps, forced: boolean): Promise<number | null> {
  const canAsk = opts.setup !== false && (deps.interactive || opts.yes);
  if (!canAsk) {
    showPlan("Something is missing before an emulator can be started:", steps);
    console.log(opts.setup === false ? "\nSetup is switched off (--no-setup)." : "\nThere is no terminal to ask in. Run start-android-emulator --setup, or add --yes to set up without asking.");
    return EXIT.failed;
  }

  const result = await deps.runPlan(forced ? "This is what we need:" : "Something is missing before an emulator can be started:", steps);
  if (result.declined) return EXIT.ok;
  if (!result.ok) return EXIT.failed;
  if (opts.dryRun) return EXIT.ok;
  if (forced) {
    console.log(`\nStart an emulator with: ${bold("npx start-android-emulator")}${result.applied.includes("env") ? dim("  (in a new terminal, so the new settings apply)") : ""}`);
    return EXIT.ok;
  }
  return null;
}

async function start(opts: Options, state: Inspection, deps: Deps): Promise<number> {
  const config = deps.readConfig();
  const name = await pickEmulator(opts, state.avds, config.lastEmulator, deps);
  if (name === null) return EXIT.failed;

  // Asking is for people who type no options and no name, anyone else knows what they want
  const ask = deps.interactive && !opts.yes && !opts.emulator && !hasStartOptions(opts);
  const chosen = ask ? await askOptions(config.dns === false, deps) : { wipeData: false, coldBoot: false, verbose: false, noDns: false };
  // When the question was asked its answer counts, otherwise a saved "no DNS" could never be undone
  const savedDns = ask && config.dns === false ? undefined : config.dns;
  const dns = chosen.noDns ? false : opts.dns ?? savedDns ?? DEFAULT_DNS;
  const startOptions = { name, wipeData: opts.wipeData || chosen.wipeData, coldBoot: opts.coldBoot || chosen.coldBoot, dns };
  const verbose = opts.verbose || chosen.verbose;

  deps.writeConfig({ lastEmulator: name, ...(ask ? { dns: chosen.noDns ? false : savedDns } : {}) });

  const adb = deps.adbBinary(state.sdk);
  if (!adb) {
    fail(`adb was not found in ${state.sdk}. Run start-android-emulator --setup to install the platform tools.`);
    return EXIT.failed;
  }

  const running = deps.findRunning(adb, name);
  if (running?.booted) {
    ok(`${name} is already running ${dim(`(adb: ${running.serial})`)}`);
    return EXIT.ok;
  }

  const dnsText = dns ? ` (DNS ${dns})` : "";
  try {
    const launched = running ? null : deps.launchEmulator(state.sdk, startOptions);
    console.log(cyan(`${running ? "Waiting for" : "Launching"} ${name}${dnsText}...`));
    if (!opts.wait) {
      info(launched ? `Started, the log is in ${launched.logFile}` : "It is already starting.");
      return EXIT.ok;
    }

    const stopLog = launched && verbose ? deps.followLog(launched.logFile, (text) => process.stdout.write(text)) : null;
    const stopSpinner = verbose ? () => {} : deps.startSpinner("Waiting for the emulator to boot...");
    let booted;
    try {
      booted = await deps.waitForBoot(adb, name, launched ?? { logFile: "", exited: null });
    } finally {
      // The line of the spinner must be gone before anything else is printed
      stopSpinner();
      stopLog?.();
    }
    ok(`${name} is ready ${dim(`(adb: ${booted.serial})`)}`);
    return EXIT.ok;
  } catch (e) {
    fail((e as Error).message);
    return EXIT.failed;
  }
}

/** The emulator to start: the one that was named, the only one there is, or a pick from the list. Null after an error is shown. */
async function pickEmulator(opts: Options, avds: string[], last: string | undefined, deps: Deps): Promise<string | null> {
  if (opts.emulator) {
    if (avds.includes(opts.emulator)) return opts.emulator;
    fail(`There is no emulator called "${opts.emulator}". The emulators on this machine: ${avds.join(", ") || "none"}`);
    return null;
  }
  if (avds.length === 0) {
    fail("No emulators found. Run start-android-emulator --setup to create one.");
    return null;
  }
  if (avds.length === 1) {
    info(`Using the only emulator: ${avds[0]}`);
    return avds[0]!;
  }
  if (!deps.interactive) {
    fail(`There is no terminal to pick an emulator in. Give its name: start-android-emulator <emulator>\nThe emulators on this machine: ${avds.join(", ")}`);
    return null;
  }
  return deps.select({
    message: "Which emulator do you want to start?",
    choices: avds.map((value) => ({ value, name: value === last ? `${value} ${dim("(last used)")}` : value })),
    default: last && avds.includes(last) ? last : avds[0],
  });
}

async function askOptions(dnsOff: boolean, deps: Deps) {
  const picked = await deps.checkbox({
    message: "Start options (space to select, enter to continue)",
    choices: [
      { value: "wipe", name: "Wipe data" },
      { value: "cold", name: "Cold boot (no snapshot)" },
      { value: "verbose", name: "Log boot output" },
      { value: "nodns", name: `Don't override DNS (use the DNS of this computer)`, checked: dnsOff },
    ],
  });
  return { wipeData: picked.includes("wipe"), coldBoot: picked.includes("cold"), verbose: picked.includes("verbose"), noDns: picked.includes("nodns") };
}
