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
    inspect: spy("inspect", async () => state),
    fetchVersions: spy("fetchVersions", async () => ({ versions: [v37, v36, v29], source: "live" as const })),
    runPlan: spy("runPlan", async () => ({ ok: true, applied: [] as string[], declined: false })),
    findRunning: spy("findRunning", () => null),
    launchEmulator: spy("launchEmulator", () => ({ child: {} as never, logFile: "/tmp/x.log", exited: null })),
    waitForBoot: spy("waitForBoot", async () => ({ serial: "emulator-5554", booted: true })),
    followLog: spy("followLog", () => () => {}),
    startSpinner: spy("startSpinner", () => () => {}),
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

test("--help shows the banner, what you can do with it and the options; --version only the version", async () => {
  assert.equal(await main(["--help"], fakeDeps()), EXIT.ok);
  assert.match(text(), /^Android Emulator CLI Helper v?[\d.]*\n/);
  assert.ok(text().endsWith(HELP.trimEnd()));
  assert.match(HELP, /^Start an Android emulator from your terminal\.\nNo Java or Android SDK yet\? We set it up for you\./);
  assert.match(HELP, /\n  start-android-emulator \[emulator\]\s+Pick an emulator, or start one by name\n/);
  assert.match(HELP, /Start options\n[\s\S]*--wipe-data/);
  output = [];
  assert.equal(await main(["--version"], fakeDeps()), EXIT.ok);
  assert.match(text(), /^\d+\.\d+\.\d+$/, "nothing but the version");
  assert.equal(calls.inspect, undefined);
});

test("the banner and what the tool can do are shown on every run", async () => {
  await main(["Pixel_8"], fakeDeps({ printBanner: spy("printBanner", () => {}), printAbout: spy("printAbout", () => {}) }));
  assert.equal(calls.printBanner!.length, 1);
  assert.equal(calls.printAbout!.length, 1);
  for (const args of [["--check"], []]) {
    for (const key of ["printBanner", "printAbout"]) delete calls[key];
    await main(args, fakeDeps({ printBanner: spy("printBanner", () => {}), printAbout: spy("printAbout", () => {}) }));
    assert.equal(calls.printAbout!.length, 1, args.join(" ") || "no arguments");
  }
});

test("--help shows the banner, and the intro through the help text, not twice", async () => {
  await main(["--help"], fakeDeps({ printBanner: spy("printBanner", () => {}), printAbout: spy("printAbout", () => {}) }));
  assert.equal(calls.printBanner!.length, 1);
  assert.equal(calls.printAbout, undefined, "the help already has it");
  assert.equal((text().match(/No Java or Android SDK yet\?/g) ?? []).length, 1);
});

test("nothing of the banner is shown for the version or for a mistake in the command", async () => {
  await main(["--version"], fakeDeps({ printBanner: spy("printBanner", () => {}), printAbout: spy("printAbout", () => {}) }));
  await main(["--nope"], fakeDeps({ printBanner: spy("printBanner", () => {}), printAbout: spy("printAbout", () => {}) }));
  assert.equal(calls.printBanner, undefined);
  assert.equal(calls.printAbout, undefined);
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

// ─── --setup, --create, --dry-run and --check ─────────────────────────────

test("--setup shows the plan even when nothing is missing, and then stops with a hint", async () => {
  assert.equal(await main(["--setup"], fakeDeps({ runPlan: spy("runPlan", async () => ({ ok: true, applied: ["env"], declined: false })) })), EXIT.ok);
  assert.match(calls.runPlan![0]![0] as string, /This is what we need/);
  assert.equal((calls.runPlan![0]![1] as unknown[]).length, 5, "all the steps, not only what is needed to start");
  assert.equal(calls.launchEmulator, undefined);
  assert.match(text(), /Start an emulator with: npx start-android-emulator.*new terminal/);
});

test("--create plans the named emulators, with the newest version unless --api is given", async () => {
  await main(["--create", "Workshop_1_Pixel_10_API_{api}", "--create", "Workshop_2_Pixel_10_API_{api}", "--skin", "pixel_10", "--yes"], fakeDeps());
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
  assert.match(text(), /Java 17\+.*Java 21[\s\S]*Emulators:\n  - Pixel_8\n  - Pixel_9_API_37_0\n  - Pixel_9_Pro[\s\S]*Everything is set up/, "every step is shown, also those that are done");
  assert.equal(calls.launchEmulator, undefined);
});

test("--check does not fail on what is only nice to have", async () => {
  state = { ...ready, env: { vars: ["ANDROID_HOME"], pathMissing: true } };
  assert.equal(await main(["--check"], fakeDeps()), EXIT.ok);
  assert.match(text(), /Environment variables, missing/);
});

test("the spinner is gone before the result is printed, so the result gets a line of its own", async () => {
  const startSpinner = () => () => output.push("<spinner stopped>");
  await main(["Pixel_8"], fakeDeps({ startSpinner }));
  const lines = text().split("\n");
  assert.ok(lines.indexOf("<spinner stopped>") >= 0 && lines.indexOf("<spinner stopped>") < lines.findIndex((l) => /is ready/.test(l)));
});

test("the spinner is also stopped when the emulator does not boot", async () => {
  const startSpinner = () => () => output.push("<spinner stopped>");
  const waitForBoot = async () => {
    throw new Error("boom");
  };
  await main(["Pixel_8"], fakeDeps({ startSpinner, waitForBoot }));
  const lines = text().split("\n");
  assert.ok(lines.indexOf("<spinner stopped>") < lines.findIndex((l) => /boom/.test(l)));
});

test("everything we print starts at the left edge, like the questions", async () => {
  await main(["Pixel_8"], fakeDeps());
  const lines = text().split("\n").filter((l) => l.trim());
  assert.ok(lines.every((l) => /^\S/.test(l)), lines.filter((l) => /^\s/.test(l)).join(" | "));
});

// ─── --delete ───────────────────────────────────────────────────────────────

const deleted = () => (calls.deleteAvd ?? []).map((c) => c[2]);
const deleteDeps = (overrides: Partial<Deps> = {}) =>
  fakeDeps({
    deleteAvd: spy("deleteAvd", async () => ({ output: "", exitCode: 0 })),
    confirm: spy("confirm", async () => true),
    ...overrides,
  });

test("--delete asks first and deletes the named emulators", async () => {
  assert.equal(await main(["--delete", "Pixel_8", "--delete", "Pixel_9_Pro"], deleteDeps()), EXIT.ok);
  assert.equal(calls.confirm!.length, 1);
  assert.deepEqual(deleted(), ["Pixel_8", "Pixel_9_Pro"]);
  assert.match(text(), /Deleted Pixel_8/);
});

test("--delete does nothing when the answer is no", async () => {
  assert.equal(await main(["--delete", "Pixel_8"], deleteDeps({ confirm: spy("confirm", async () => false) })), EXIT.ok);
  assert.deepEqual(deleted(), []);
  assert.match(text(), /Nothing deleted/);
});

test("--delete --yes does not ask", async () => {
  assert.equal(await main(["--delete", "Pixel_8", "--yes"], deleteDeps()), EXIT.ok);
  assert.equal(calls.confirm, undefined);
  assert.deepEqual(deleted(), ["Pixel_8"]);
});

test("--delete --dry-run only says what it would delete", async () => {
  assert.equal(await main(["--delete", "Pixel_8", "--dry-run"], deleteDeps()), EXIT.ok);
  assert.deepEqual(deleted(), []);
  assert.match(text(), /would delete Pixel_8/);
});

test("--delete refuses an unknown emulator and a running one", async () => {
  assert.equal(await main(["--delete", "Nope", "--yes"], deleteDeps()), EXIT.failed);
  assert.match(text(), /no emulator called "Nope"/);
  output = [];
  const running = { serial: "emulator-5554", booted: true };
  assert.equal(await main(["--delete", "Pixel_8", "--yes"], deleteDeps({ findRunning: spy("findRunning", () => running) })), EXIT.failed);
  assert.match(text(), /Pixel_8 is running/);
  assert.deepEqual(deleted(), []);
});

test("--delete reports a failure of avdmanager", async () => {
  assert.equal(await main(["--delete", "Pixel_8", "--yes"], deleteDeps({ deleteAvd: spy("deleteAvd", async () => ({ output: "boom", exitCode: 1 })) })), EXIT.failed);
  assert.match(text(), /Deleting Pixel_8 failed/);
});

// ─── --create without a name ────────────────────────────────────────────────

/** Answers the questions in order: version, then device and name per emulator (and the typed text when asked). */
const answering = (answers: string[], typed: string[] = [], another: boolean[] = [false]) => ({
  select: spy("select", async () => answers.shift()!),
  input: spy("input", async () => typed.shift()!),
  confirm: spy("confirm", async () => another.shift() ?? false),
});
const plannedTarget = () => calls.planAndroid?.at(-1)?.[1] as { version: { api: string }; avds: { name: string; device: { profile: string; skin: string } }[] };

test("--create without a name asks for version, device and name, and plans that emulator", async () => {
  const deps = fakeDeps({ ...answering(["36", "0", "Pixel_10_API_36"]), planAndroid: spy("planAndroid", () => []) });
  assert.equal(await main(["--create"], deps), EXIT.ok);
  assert.equal(calls.select!.length, 3);
  assert.equal(plannedTarget().version.api, "36");
  assert.deepEqual(plannedTarget().avds, [{ name: "Pixel_10_API_36", device: { profile: "pixel_9", skin: "pixel_10" } }]);
});

test("--create without a name keeps asking for emulators while the answer is yes, with the version asked once", async () => {
  const deps = fakeDeps({ ...answering(["36", "0", "Pixel_10_API_36", "2", "Pixel_9_Pro_API_36"], [], [true, false]), planAndroid: spy("planAndroid", () => []) });
  assert.equal(await main(["--create"], deps), EXIT.ok);
  assert.equal(calls.select!.length, 5);
  assert.deepEqual(plannedTarget().avds.map((a) => [a.name, a.device.skin]), [["Pixel_10_API_36", "pixel_10"], ["Pixel_9_Pro_API_36", "pixel_9_pro"]]);
});

test("a name that is already taken in this run has to be typed", async () => {
  const deps = fakeDeps({ ...answering(["36", "1", "Pixel_9_API_36", "1"], ["Pixel_9_Second"], [true, false]), planAndroid: spy("planAndroid", () => []) });
  await main(["--create"], deps);
  assert.deepEqual(plannedTarget().avds.map((a) => a.name), ["Pixel_9_API_36", "Pixel_9_Second"]);
  assert.equal(calls.input!.length, 1);
});

test("--create without a name does not ask what was given, and takes a typed name or hardware profile", async () => {
  const deps = fakeDeps({ ...answering(["__custom__"], ["My_Phone"]), planAndroid: spy("planAndroid", () => []) });
  assert.equal(await main(["--create", "--api", "36", "--device", "pixel_7"], deps), EXIT.ok);
  assert.equal(calls.select!.length, 1, "only the name is asked");
  assert.deepEqual(plannedTarget().avds, [{ name: "My_Phone", device: { profile: "pixel_7", skin: "pixel_7" } }]);
});

test("--create without a name needs a terminal", async () => {
  assert.equal(await main(["--create"], fakeDeps({ interactive: false })), EXIT.usage);
  assert.match(text(), /no terminal to ask in/);
});

test("--delete without a name lets you pick the emulators from a list", async () => {
  const deps = deleteDeps({ checkbox: spy("checkbox", async () => ["Pixel_8", "Pixel_9_Pro"]) });
  assert.equal(await main(["--delete"], deps), EXIT.ok);
  assert.deepEqual((calls.checkbox![0]![0] as { choices: { value: string }[] }).choices.map((c) => c.value), AVDS);
  assert.deepEqual(deleted(), ["Pixel_8", "Pixel_9_Pro"]);
});

test("--delete without a name and nothing picked deletes nothing; without a terminal it is a usage error", async () => {
  assert.equal(await main(["--delete"], deleteDeps()), EXIT.ok);
  assert.deepEqual(deleted(), []);
  assert.match(text(), /Nothing deleted/);
  assert.equal(await main(["--delete"], deleteDeps({ interactive: false })), EXIT.usage);
});

// ─── --update and --prune ───────────────────────────────────────────────────

const IMG37 = "system-images;android-37.0;google_apis;arm64-v8a";
const IMG30 = "system-images;android-30;google_apis;arm64-v8a";
const maintainDeps = (overrides: Partial<Deps> = {}) =>
  fakeDeps({
    avdImage: spy("avdImage", () => IMG37),
    listUpdates: spy("listUpdates", async () => [
      { id: "platform-tools", installed: "1", available: "2" },
      { id: IMG37, installed: "6", available: "7" },
      { id: IMG30, installed: "13", available: "16" },
    ]),
    listInstalledPackages: spy("listInstalledPackages", async () => new Set(["emulator", IMG37, IMG30, "platforms;android-30", "platforms;android-37.0"])),
    acceptLicenses: spy("acceptLicenses", () => true),
    installPackages: spy("installPackages", () => true),
    uninstallPackage: spy("uninstallPackage", async () => ({ output: "", exitCode: 0 })),
    confirm: spy("confirm", async () => true),
    checkbox: spy("checkbox", async (options: { choices: { value: string; checked?: boolean }[] }) => options.choices.filter((c) => c.checked).map((c) => c.value)),
    ...overrides,
  });

test("--update installs the updates of what is in use and skips images no emulator uses", async () => {
  assert.equal(await main(["--update"], maintainDeps()), EXIT.ok);
  assert.deepEqual(calls.installPackages![0]![2], ["platform-tools", IMG37]);
  assert.match(text(), /1 newer system image skipped.*android-30/);
  assert.match(text(), /now use the newer system image, their data is kept/);
});

test("--update --dry-run, answering no and being up to date change nothing", async () => {
  assert.equal(await main(["--update", "--dry-run"], maintainDeps()), EXIT.ok);
  assert.equal(await main(["--update"], maintainDeps({ confirm: spy("confirm", async () => false) })), EXIT.ok);
  assert.equal(await main(["--update"], maintainDeps({ listUpdates: spy("listUpdates", async () => []) })), EXIT.ok);
  assert.equal(calls.installPackages, undefined);
  assert.match(text(), /up to date/);
});

test("--update fails when it cannot ask for updates or an install fails", async () => {
  assert.equal(await main(["--update"], maintainDeps({ listUpdates: spy("listUpdates", async () => null) })), EXIT.failed);
  assert.equal(await main(["--update", "--yes"], maintainDeps({ installPackages: spy("installPackages", () => false) })), EXIT.failed);
});

test("--prune offers everything unused, all selected, and removes what you pick", async () => {
  assert.equal(await main(["--prune"], maintainDeps()), EXIT.ok);
  const choices = (calls.checkbox![0]![0] as { choices: { value: string; checked: boolean }[] }).choices;
  assert.deepEqual(choices.map((c) => [c.value, c.checked]), [["platforms;android-30", true], [IMG30, true]]);
  assert.deepEqual(calls.uninstallPackage!.map((c) => c[2]), ["platforms;android-30", IMG30]);
});

test("--prune --yes removes everything unused, --dry-run removes nothing, and no is no", async () => {
  await main(["--prune", "--yes"], maintainDeps());
  assert.deepEqual(calls.uninstallPackage!.map((c) => c[2]), ["platforms;android-30", IMG30]);
  calls.uninstallPackage = [];
  await main(["--prune", "--dry-run"], maintainDeps());
  await main(["--prune"], maintainDeps({ confirm: spy("confirm", async () => false) }));
  assert.equal(calls.uninstallPackage.length, 0);
  assert.match(text(), /would remove .*android-30/);
});

test("--prune has nothing to do when every image is used, and refuses when an emulator cannot be read", async () => {
  assert.equal(await main(["--prune"], maintainDeps({ listInstalledPackages: spy("l", async () => new Set([IMG37, "platforms;android-37.0"])) })), EXIT.ok);
  assert.match(text(), /Nothing to remove/);
  assert.equal(await main(["--prune"], maintainDeps({ avdImage: spy("avdImage", () => null) })), EXIT.failed);
  assert.match(text(), /Could not read which system image/);
});

test("--prune without a terminal needs --yes or --dry-run", async () => {
  assert.equal(await main(["--prune"], maintainDeps({ interactive: false })), EXIT.usage);
});

test("--prune goes on after a package that cannot be removed, and shows why", async () => {
  const images = new Set([IMG37, "system-images;android-27;google_apis;arm64-v8a", IMG30]);
  const deps = maintainDeps({
    listInstalledPackages: spy("l", async () => images),
    uninstallPackage: spy("uninstallPackage", async (_sdk: string, _jdk: string, id: string) =>
      id === IMG30 ? { output: "Loading local repository...\n[=====] 49% Loading\nInfo: \"Uninstall X\" failed.", exitCode: 1 } : { output: "", exitCode: 0 }),
  });
  assert.equal(await main(["--prune", "--yes"], deps), EXIT.failed);
  assert.equal(calls.uninstallPackage!.length, 2, "the other package is still removed");
  assert.match(text(), /Removed system-images;android-27/);
  assert.match(text(), /Removing system-images;android-30.* failed\n.*"Uninstall X" failed/);
  assert.doesNotMatch(text(), /49%/);
});

// ─── the spinner while we wait ──────────────────────────────────────────────

const spinnerTexts = () => (calls.startSpinner ?? []).map((c) => c[0] as string);

test("looking at the machine shows a spinner that says what we are doing, per command", async () => {
  await main(["--check"], fakeDeps());
  assert.equal(spinnerTexts()[0], "Checking what is set up...");
  for (const key of Object.keys(calls)) delete calls[key];
  await main(["Pixel_8"], fakeDeps());
  assert.equal(spinnerTexts()[0], "Checking your setup...");
  for (const key of Object.keys(calls)) delete calls[key];
  await main(["--delete", "Pixel_8", "--yes"], deleteDeps());
  assert.deepEqual(spinnerTexts(), ["Looking up your emulators...", "Deleting Pixel_8..."]);
});

test("--update and --prune say what they look for", async () => {
  await main(["--update", "--dry-run"], maintainDeps());
  assert.deepEqual(spinnerTexts(), ["Checking your Android SDK...", "Looking for updates..."]);
  for (const key of Object.keys(calls)) delete calls[key];
  await main(["--prune", "--dry-run"], maintainDeps());
  assert.deepEqual(spinnerTexts(), ["Checking your Android SDK...", "Looking for SDK packages no emulator uses..."]);
});

test("the spinner is gone again when the work fails", async () => {
  const stopped: string[] = [];
  const deps = maintainDeps({
    startSpinner: spy("startSpinner", (text: string) => () => stopped.push(text)),
    listUpdates: spy("listUpdates", async () => { throw new Error("boom"); }),
  });
  await assert.rejects(main(["--update"], deps), /boom/);
  assert.deepEqual(stopped, ["Checking your Android SDK...", "Looking for updates..."]);
});
