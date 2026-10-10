import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { HELP } from "../src/args.ts";
import { EXIT, main, type Deps } from "../src/flow.ts";
import type { Inspection } from "../src/android/inspect.ts";
import { settings } from "../src/ui.ts";

const v37 = { api: "37.0", label: "Android 17 (API 37.0)" };
const v36 = { api: "36", label: "Android 16 (API 36)" };
const v29 = { api: "29", label: "Android 10 (API 29)" };
const AVDS = ["Pixel_8", "Pixel_9_API_37_0", "Pixel_9_Pro"];

const ready: Inspection = {
  sdk: "/sdk",
  sdkFound: true,
  java: { home: "/jdk", major: 21, source: "JAVA_HOME" },
  toolsReady: true,
  installedPackages: new Set(),
  emulatorReady: true,
  avds: AVDS,
  env: { vars: [], pathMissing: false },
};
const bare: Inspection = { ...ready, sdkFound: false, java: null, toolsReady: false, emulatorReady: false, avds: [], env: { vars: ["ANDROID_HOME", "JAVA_HOME"], pathMissing: true } };

let output: string[];
let state: Inspection;
const calls: Record<string, unknown[][]> = {};
const spy = <T>(name: string, impl: (...args: any[]) => T) =>
  (...args: unknown[]): T => {
    (calls[name] ??= []).push(args);
    return impl(...args);
  };

/** Deps where nothing really happens: the machine is `state`, the user presses enter on every question. */
function fakeDeps(overrides: Partial<Deps> = {}): Partial<Deps> {
  return {
    inspect: spy("inspect", () => state),
    fetchVersions: spy("fetchVersions", async () => ({ versions: [v37, v36, v29], source: "live" as const })),
    runPlan: spy("runPlan", async () => ({ ok: true, applied: [] as string[], declined: false })),
    findRunning: spy("findRunning", () => null),
    launchEmulator: spy("launchEmulator", () => ({ child: {} as never, logFile: "/tmp/x.log", exited: null })),
    waitForBoot: spy("waitForBoot", async () => ({ serial: "emulator-5554", booted: true })),
    followLog: spy("followLog", () => () => {}),
    adbBinary: spy("adbBinary", () => "/sdk/platform-tools/adb"),
    readConfig: spy("readConfig", () => ({})),
    writeConfig: spy("writeConfig", () => {}),
    relaunchWithProxy: spy("relaunchWithProxy", () => null),
    select: spy("select", async (options: { default?: string; choices: { value: string }[] }) => options.default ?? options.choices[0]!.value),
    checkbox: spy("checkbox", async () => [] as string[]),
    interactive: true,
    ...overrides,
  };
}
const text = () => output.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
const launchedWith = () => calls.launchEmulator!.at(-1)![1] as { name: string; wipeData: boolean; coldBoot: boolean; dns: string | false };

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  output = [];
  state = ready;
  settings.yes = false;
  settings.dryRun = false;
  mock.method(console, "log", (...args: unknown[]) => output.push(args.join(" ")));
});
afterEach(() => mock.restoreAll());

// ─── the simple answers ─────────────────────────────────────────────────────

test("--help shows the options and --version the version, without looking at the machine", async () => {
  assert.equal(await main(["--help"], fakeDeps()), EXIT.ok);
  assert.equal(text(), HELP.trimEnd());
  output = [];
  assert.equal(await main(["--version"], fakeDeps()), EXIT.ok);
  assert.match(text(), /^\d+\.\d+\.\d+/);
  assert.equal(calls.inspect, undefined);
});

test("a mistake in the command exits with 2 and says what to do", async () => {
  assert.equal(await main(["--nope"], fakeDeps()), EXIT.usage);
  assert.match(text(), /--nope[\s\S]*--help/);
});

test("behind a proxy the run of the relaunched program is the one that counts", async () => {
  assert.equal(await main([], fakeDeps({ relaunchWithProxy: () => 7 })), 7);
  assert.equal(calls.inspect, undefined);
});

test("Ctrl+C at a question ends quietly with the usual code", async () => {
  const cancelled = Object.assign(new Error("User force closed the prompt"), { name: "ExitPromptError" });
  assert.equal(await main([], fakeDeps({ select: async () => { throw cancelled; } })), EXIT.cancelled);
  assert.match(text(), /Cancelled/);
});

// ─── starting an emulator ───────────────────────────────────────────────────

test("when everything is there you pick an emulator and answer one question, no setup and no network", async () => {
  assert.equal(await main([], fakeDeps({ readConfig: () => ({ lastEmulator: "Pixel_9_API_37_0" }) })), EXIT.ok);

  assert.equal(calls.fetchVersions, undefined, "starting is not slowed down by a request to Google");
  assert.equal(calls.runPlan, undefined);
  const pick = calls.select![0]![0] as { default: string; choices: { value: string; name: string }[] };
  assert.equal(pick.default, "Pixel_9_API_37_0");
  assert.match(pick.choices.find((c) => c.value === "Pixel_9_API_37_0")!.name, /last used/);
  assert.deepEqual(launchedWith(), { name: "Pixel_9_API_37_0", wipeData: false, coldBoot: false, dns: "8.8.8.8" });
  assert.match(text(), /Launching Pixel_9_API_37_0 \(DNS 8.8.8.8\)/);
  assert.match(text(), /Pixel_9_API_37_0 is ready.*emulator-5554/);
  assert.deepEqual(calls.writeConfig![0], [{ lastEmulator: "Pixel_9_API_37_0", dns: undefined }]);
});

test("a name on the command line skips every question", async () => {
  assert.equal(await main(["Pixel_8", "--wipe-data", "--cold-boot"], fakeDeps()), EXIT.ok);
  assert.equal(calls.select, undefined);
  assert.equal(calls.checkbox, undefined);
  assert.deepEqual(launchedWith(), { name: "Pixel_8", wipeData: true, coldBoot: true, dns: "8.8.8.8" });
});

test("an emulator that does not exist is reported with the ones that do", async () => {
  assert.equal(await main(["Nope"], fakeDeps()), EXIT.failed);
  assert.match(text(), /no emulator called "Nope".*Pixel_8, Pixel_9_API_37_0, Pixel_9_Pro/);
  assert.equal(calls.launchEmulator, undefined);
});

test("with one emulator there is nothing to pick", async () => {
  state = { ...ready, avds: ["Only_One"] };
  assert.equal(await main([], fakeDeps()), EXIT.ok);
  assert.equal(calls.select, undefined);
  assert.equal(launchedWith().name, "Only_One");
  assert.match(text(), /Using the only emulator: Only_One/);
});

test("the options question: what is ticked is used, and the DNS choice is remembered", async () => {
  const checkbox = async () => ["wipe", "nodns"];
  assert.equal(await main([], fakeDeps({ checkbox })), EXIT.ok);
  assert.deepEqual(launchedWith(), { name: "Pixel_8", wipeData: true, coldBoot: false, dns: false });
  assert.deepEqual(calls.writeConfig![0], [{ lastEmulator: "Pixel_8", dns: false }]);
  assert.doesNotMatch(text(), /DNS/);
});

test("a remembered 'no DNS' is ticked in the question, and unticking it forgets it", async () => {
  await main([], fakeDeps({ readConfig: () => ({ dns: false as const }), checkbox: spy("checkbox", async () => ["nodns"]) }));
  const question = calls.checkbox![0]![0] as { choices: { value: string; checked?: boolean }[] };
  assert.equal(question.choices.find((c) => c.value === "nodns")!.checked, true);
  assert.equal(launchedWith().dns, false, "also when the answer is not changed");
  assert.deepEqual(calls.writeConfig![0], [{ lastEmulator: "Pixel_8", dns: false }]);

  calls.writeConfig = [];
  await main([], fakeDeps({ readConfig: () => ({ dns: false as const }), checkbox: async () => [] }));
  assert.equal(launchedWith().dns, "8.8.8.8");
  assert.deepEqual(calls.writeConfig![0], [{ lastEmulator: "Pixel_8", dns: undefined }]);
});

test("--dns beats what was remembered, and --no-dns beats the default", async () => {
  await main(["Pixel_8", "--dns", "1.1.1.1"], fakeDeps({ readConfig: () => ({ dns: false as const }) }));
  assert.equal(launchedWith().dns, "1.1.1.1");
  await main(["Pixel_8", "--no-dns"], fakeDeps());
  assert.equal((calls.launchEmulator![1]![1] as { dns: unknown }).dns, false);
});

test("any start option on the command line means the options question is not asked", async () => {
  await main(["--verbose"], fakeDeps());
  assert.equal(calls.checkbox, undefined);
  assert.equal(calls.followLog!.length, 1, "the log is shown while it boots");
});

test("with --yes the options are not asked, the emulator still has to be picked", async () => {
  await main(["--yes"], fakeDeps());
  assert.equal(calls.checkbox, undefined);
  assert.equal(calls.select!.length, 1);
  assert.equal(launchedWith().dns, "8.8.8.8");
});

test("without a terminal an emulator must be named, and nothing is asked", async () => {
  assert.equal(await main([], fakeDeps({ interactive: false })), EXIT.failed);
  assert.match(text(), /no terminal to pick an emulator in.*start-android-emulator <emulator>/s);
  output = [];
  assert.equal(await main(["Pixel_8"], fakeDeps({ interactive: false })), EXIT.ok);
  assert.equal(calls.checkbox, undefined);
});

test("an emulator that is already running is left alone", async () => {
  assert.equal(await main(["Pixel_8"], fakeDeps({ findRunning: () => ({ serial: "emulator-5556", booted: true }) })), EXIT.ok);
  assert.equal(calls.launchEmulator, undefined);
  assert.match(text(), /already running.*emulator-5556/);
});

test("an emulator that is still starting is waited for, not started a second time", async () => {
  assert.equal(await main(["Pixel_8"], fakeDeps({ findRunning: () => ({ serial: "emulator-5556", booted: false }) })), EXIT.ok);
  assert.equal(calls.launchEmulator, undefined);
  assert.equal(calls.waitForBoot!.length, 1);
});

test("--no-wait starts the emulator and returns", async () => {
  assert.equal(await main(["Pixel_8", "--no-wait"], fakeDeps()), EXIT.ok);
  assert.equal(calls.launchEmulator!.length, 1);
  assert.equal(calls.waitForBoot, undefined);
  assert.match(text(), /the log is in \/tmp\/x\.log/);
});

test("an emulator that does not boot is a failure with the reason", async () => {
  const waitForBoot = async () => { throw new Error("The emulator stopped before it was ready (exit code 1)."); };
  assert.equal(await main(["Pixel_8"], fakeDeps({ waitForBoot })), EXIT.failed);
  assert.match(text(), /stopped before it was ready/);
});

test("an emulator that cannot be launched is a failure with the reason", async () => {
  const launchEmulator = () => { throw new Error("The emulator is not installed in /sdk"); };
  assert.equal(await main(["Pixel_8"], fakeDeps({ launchEmulator })), EXIT.failed);
  assert.match(text(), /not installed/);
});

test("without adb the user is pointed to the setup", async () => {
  assert.equal(await main(["Pixel_8"], fakeDeps({ adbBinary: () => null })), EXIT.failed);
  assert.match(text(), /adb was not found in \/sdk.*--setup/);
});

// ─── when something is missing ──────────────────────────────────────────────

test("on a bare machine the plan is offered, and after it the flow goes on to start the emulator", async () => {
  state = bare;
  const runPlan = spy("runPlan", async () => {
    state = { ...ready, avds: ["Pixel_9_API_37_0"] };
    return { ok: true, applied: ["java", "env"], declined: false };
  });
  assert.equal(await main([], fakeDeps({ runPlan })), EXIT.ok);

  const [title, steps] = calls.runPlan![0] as [string, { id: string }[]];
  assert.match(title, /Something is missing/);
  assert.deepEqual(steps.map((s) => s.id), ["java", "tools", "packages", "avds", "env"]);
  assert.equal(calls.inspect!.length, 2, "the machine is looked at again after the setup");
  assert.equal(launchedWith().name, "Pixel_9_API_37_0");
});

test("when the user declines the setup nothing is started", async () => {
  state = bare;
  assert.equal(await main([], fakeDeps({ runPlan: async () => ({ ok: false, applied: [], declined: true }) })), EXIT.ok);
  assert.equal(calls.launchEmulator, undefined);
});

test("a failed setup stops the run", async () => {
  state = bare;
  assert.equal(await main([], fakeDeps({ runPlan: async () => ({ ok: false, applied: [], declined: false }) })), EXIT.failed);
  assert.equal(calls.launchEmulator, undefined);
});

test("without a terminal, or with --no-setup, nothing is installed and the missing items are listed", async () => {
  state = bare;
  assert.equal(await main([], fakeDeps({ interactive: false })), EXIT.failed);
  assert.match(text(), /Java 17\+, missing[\s\S]*no terminal to ask in.*--yes/s);
  output = [];
  assert.equal(await main(["--no-setup"], fakeDeps()), EXIT.failed);
  assert.match(text(), /\(--no-setup\)/);
  assert.equal(calls.runPlan, undefined);
});

test("--yes sets up without a terminal", async () => {
  state = bare;
  await main(["--yes"], fakeDeps({ interactive: false }));
  assert.equal(calls.runPlan!.length, 1);
});

test("the Android version of a new emulator is asked for, from the versions that are not too old", async () => {
  state = bare;
  await main([], fakeDeps({ select: async () => "36" }));
  assert.equal(calls.fetchVersions!.length, 1);
  const [, steps] = calls.runPlan![0] as [string, { id: string; description: string }[]];
  assert.match(steps.find((s) => s.id === "avds")!.description, /Android 16 \(API 36\)[\s\S]*Pixel_9_API_36/);
});

test("the version list offered leaves out the old versions, and --yes takes the newest", async () => {
  state = bare;
  const select = spy("select", async (options: { default: string }) => options.default);
  await main([], fakeDeps({ select }));
  const options = calls.select![0]![0] as { choices: { value: string }[]; default: string };
  assert.deepEqual(options.choices.map((c) => c.value), ["37.0", "36"]);
  assert.equal(options.default, "37.0");

  calls.select = [];
  await main(["--yes"], fakeDeps({ select }));
  assert.equal(calls.select.length, 0);
});

test("--api picks the version, and a version that does not exist is a usage error", async () => {
  state = bare;
  await main(["--api", "36", "--yes"], fakeDeps());
  const [, steps] = calls.runPlan![0] as [string, { id: string; description: string }[]];
  assert.match(steps.find((s) => s.id === "avds")!.description, /Pixel_9_API_36/);

  output = [];
  assert.equal(await main(["--api", "12", "--yes"], fakeDeps()), EXIT.usage);
  assert.match(text(), /"12" is not available\. Choose one of: 37\.0, 36, 29/);
});

test("when Google's list cannot be read the user is told the built-in list is used", async () => {
  state = bare;
  await main(["--yes"], fakeDeps({ fetchVersions: async () => ({ versions: [v37], source: "built-in" as const }) }));
  assert.match(text(), /Could not read the list of Android versions.*built-in/);
});

// ─── --setup, --workshop, --dry-run and --check ─────────────────────────────

test("--setup shows the plan even when nothing is missing, and then stops with a hint", async () => {
  assert.equal(await main(["--setup"], fakeDeps({ runPlan: spy("runPlan", async () => ({ ok: true, applied: ["env"], declined: false })) })), EXIT.ok);
  assert.match(calls.runPlan![0]![0] as string, /This is what we need/);
  assert.equal((calls.runPlan![0]![1] as unknown[]).length, 5, "all the steps, not only what is needed to start");
  assert.equal(calls.launchEmulator, undefined);
  assert.match(text(), /Start an emulator with: npx start-android-emulator.*new terminal/);
});

test("--workshop plans the two workshop emulators, with the newest version unless --api is given", async () => {
  await main(["--workshop", "--yes"], fakeDeps());
  const [, steps] = calls.runPlan![0] as [string, { id: string; description: string; required?: boolean }[]];
  assert.match(steps.find((s) => s.id === "avds")!.description, /Workshop_1_Pixel_10_API_37_0 and Workshop_2_Pixel_10_API_37_0/);
  assert.equal(steps.find((s) => s.id === "env")!.required, true);
  assert.equal(calls.select, undefined, "attendees do not choose a version");
});

test("--dry-run goes through the plan and never starts an emulator", async () => {
  assert.equal(await main(["--dry-run", "--yes"], fakeDeps()), EXIT.ok);
  assert.equal(settings.dryRun, true);
  assert.equal(calls.runPlan!.length, 1);
  assert.equal(calls.launchEmulator, undefined);
});

test("--check lists what is there and what is missing, and exits with 1 when something blocks", async () => {
  state = bare;
  assert.equal(await main(["--check"], fakeDeps()), EXIT.failed);
  assert.match(text(), /Java 17\+, missing[\s\S]*Something is missing/);
  assert.equal(calls.runPlan, undefined, "it only looks");

  state = ready;
  output = [];
  assert.equal(await main(["--check"], fakeDeps()), EXIT.ok);
  assert.match(text(), /Java 17\+.*Java 21[\s\S]*Emulators: Pixel_8, Pixel_9_API_37_0, Pixel_9_Pro[\s\S]*Everything is set up/, "every step is shown, also those that are done");
  assert.equal(calls.launchEmulator, undefined);
});

test("--check does not fail on what is only nice to have", async () => {
  state = { ...ready, env: { vars: ["ANDROID_HOME"], pathMissing: true } };
  assert.equal(await main(["--check"], fakeDeps()), EXIT.ok);
  assert.match(text(), /Environment variables, missing/);
});
