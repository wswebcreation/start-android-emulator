import { checkbox, select } from "@inquirer/prompts";
import { readFileSync } from "node:fs";
import { HELP, UsageError, hasStartOptions, parseOptions, type Options } from "./args.ts";
import { DEFAULT_DNS, findRunning, followLog, launchEmulator, waitForBoot } from "./android/emulator.ts";
import { type Inspection, inspect } from "./android/inspect.ts";
import { adbBinary } from "./android/sdk.ts";
import { defaultTarget, planAndroid, workshopTarget } from "./android/setup.ts";
import { type AndroidVersion, fetchVersions, resolveVersion } from "./android/versions.ts";
import { readConfig, writeConfig } from "./config.ts";
import { relaunchWithProxy } from "./network.ts";
import { blocking, runPlan, showPlan, type Step } from "./plan.ts";
import { bold, cyan, dim, fail, info, ok, settings, startSpinner, warn } from "./ui.ts";

/** Everything the flow reaches out to, so a test can replace the parts it does not want to run for real. */
export const realDeps = {
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
    if (opts.help) return print(HELP);
    if (opts.version) return print(packageVersion());

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
  console.log(cyan(`\nAndroid Emulator CLI Helper ${packageVersion()}\nBy: @wswebcreation\n`));

  let state = deps.inspect();
  const wantsPlan = opts.setup === true || opts.workshop || opts.dryRun;
  const canStart = state.emulatorReady && state.avds.length > 0;

  if (wantsPlan || opts.check || !canStart) {
    const version = await chooseVersion(opts, state, deps);
    const target = opts.workshop ? workshopTarget(version) : defaultTarget(version);
    const steps = deps.planAndroid(state, target);

    if (opts.check) return check(state, steps);

    if (wantsPlan || blocking(steps).length > 0) {
      const finished = await setup(opts, steps, deps, wantsPlan);
      if (finished !== null) return finished;
      state = deps.inspect();
    }
  } else {
    ok(`Android SDK ${dim(state.sdk)}`);
    ok(`${state.avds.length} emulator${state.avds.length === 1 ? "" : "s"} found`);
  }

  return start(opts, state, deps);
}

/** The Android version for the emulator we might create: --api, the newest, or a pick from the list. */
async function chooseVersion(opts: Options, state: Inspection, deps: Deps): Promise<AndroidVersion> {
  const { versions, source } = await deps.fetchVersions();
  if (source === "built-in") warn("Could not read the list of Android versions from Google, using the built-in list.");

  if (opts.api) return pickVersion(opts.api, versions);

  const newest = versions[0]!;
  const willCreate = state.avds.length === 0 && !opts.workshop && !opts.check && !opts.dryRun;
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
  if (state.avds.length > 0) info(`Emulators: ${state.avds.join(", ")}`);
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
