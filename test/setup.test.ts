import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";

const realSdk = await import("../src/android/sdk.ts");
const realAvd = await import("../src/android/avd.ts");
const realJava = await import("../src/java.ts");

const installJdk = mock.fn(async (): Promise<string> => "/downloaded/jdk");
const javaMajor = mock.fn((_home: string): number | null => 21);
const installCmdlineTools = mock.fn(async (_sdk: string) => {});
const acceptLicenses = mock.fn((_sdk: string, _jdk: string) => true);
const installPackages = mock.fn((_sdk: string, _jdk: string, _packages: string[]) => true);
const hasSkin = mock.fn((_sdk: string, _skin: string) => false);
const installSkin = mock.fn(async (_sdk: string, _skin: string) => {});
const createAvd = mock.fn((_sdk: string, _jdk: string, _options: unknown) => ({ output: "", exitCode: 0 }));
const persistEnv = mock.fn((_changes: unknown) => "~/.zshrc");
const applyToProcess = mock.fn((_changes: unknown) => {});

mock.module("../src/java.ts", { namedExports: { ...realJava, installJdk, javaMajor } });
mock.module("../src/android/sdk.ts", { namedExports: { ...realSdk, installCmdlineTools, acceptLicenses, installPackages } });
mock.module("../src/android/avd.ts", { namedExports: { ...realAvd, hasSkin, installSkin, createAvd } });
mock.module("../src/env.ts", { namedExports: { persistEnv, applyToProcess } });
const { defaultTarget, namedTarget, planAndroid } = await import("../src/android/setup.ts");
const { blocking } = await import("../src/plan.ts");
const { settings } = await import("../src/ui.ts");
const { requiredPackages } = await import("../src/android/versions.ts");
import type { Inspection } from "../src/android/inspect.ts";

const v37 = { api: "37.0", label: "Android 17 (API 37.0)" };
const ALL_PACKAGES = requiredPackages(v37);

const java = { home: "/jdk", major: 21, source: "JAVA_HOME" as const };
const bare: Inspection = {
  sdk: "/sdk",
  sdkFound: false,
  java: null,
  toolsReady: false,
  installedPackages: null,
  emulatorReady: false,
  avds: [],
  env: { vars: ["ANDROID_HOME", "JAVA_HOME"], pathMissing: true },
};
const complete: Inspection = {
  sdk: "/sdk",
  sdkFound: true,
  java,
  toolsReady: true,
  installedPackages: new Set(ALL_PACKAGES),
  emulatorReady: true,
  avds: ["Pixel_9_API_37_0"],
  env: { vars: [], pathMissing: false },
};
const ids = (steps: { id: string }[]) => steps.map((s) => s.id);

let output: string[];
beforeEach(() => {
  settings.dryRun = false;
  output = [];
  mock.method(console, "log", (...args: unknown[]) => output.push(args.join(" ")));
  for (const fn of [installJdk, installCmdlineTools, acceptLicenses, installPackages, hasSkin, installSkin, createAvd, persistEnv, applyToProcess]) fn.mock.resetCalls();
  acceptLicenses.mock.mockImplementation(() => true);
  installPackages.mock.mockImplementation(() => true);
  createAvd.mock.mockImplementation(() => ({ output: "", exitCode: 0 }));
  hasSkin.mock.mockImplementation(() => false);
  installSkin.mock.mockImplementation(async () => {});
  installJdk.mock.mockImplementation(async () => "/downloaded/jdk");
  installCmdlineTools.mock.mockImplementation(async () => {});
});
afterEach(() => mock.restoreAll());

// ─── the plan ───────────────────────────────────────────────────────────────

test("a bare machine needs every step, with the emulator named like Android Studio would", () => {
  const steps = planAndroid(bare, defaultTarget(v37));
  assert.deepEqual(ids(steps), ["java", "tools", "packages", "avds", "env"]);
  assert.ok(steps.every((s) => !s.done));
  assert.match(steps[3]!.description, /Pixel_9_API_37_0/);
  assert.equal(steps[3]!.title, "An emulator");
});

test("a machine that is complete needs nothing", () => {
  const steps = planAndroid(complete, defaultTarget(v37));
  assert.deepEqual(ids(steps), ["java", "tools", "packages", "avds", "env"]);
  assert.ok(steps.every((s) => s.done));
  assert.equal(blocking(steps).length, 0);
});

test("with an emulator already there, Java and the SDK are nice to have, they do not stop it from starting", () => {
  const state: Inspection = { ...complete, java: null, toolsReady: false, installedPackages: null, env: { vars: ["ANDROID_HOME", "JAVA_HOME"], pathMissing: true } };
  const steps = planAndroid(state, defaultTarget(v37));
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));

  assert.equal(blocking(steps).length, 0);
  assert.deepEqual(ids(steps.filter((s) => !s.done)), ["java", "tools", "env"], "but they are still listed, for --setup and --check");
  assert.equal(byId.packages!.done, true, "what we cannot ask about is not asked for");
  assert.equal(byId.java!.required, false);
  assert.equal(byId.env!.required, false);
});

test("the environment step does not set JAVA_HOME when there is no Java", async () => {
  const state: Inspection = { ...complete, java: null, env: { vars: ["JAVA_HOME"], pathMissing: false } };
  const env = planAndroid(state, defaultTarget(v37)).find((s) => s.id === "env")!;
  assert.equal(await env.apply(), true);
  assert.deepEqual(persistEnv.mock.calls[0]!.arguments[0], { vars: {}, paths: [] });
});

test("an emulator program that is missing is a blocking step, even when emulators exist", () => {
  const state: Inspection = { ...complete, emulatorReady: false, installedPackages: new Set() };
  const steps = planAndroid(state, defaultTarget(v37));
  assert.deepEqual(ids(blocking(steps)), ["packages"].concat(state.java ? [] : ["java"]));
  assert.match(steps.find((s) => s.id === "packages")!.description, /Android 17/);
});

const workshopTarget = (version: typeof v37) =>
  namedTarget(version, ["Workshop_1_Pixel_10_API_{api}", "Workshop_2_Pixel_10_API_{api}"], { profile: "pixel_9", skin: "pixel_10" });

test("named emulators are all needed by name, and the environment is required", () => {
  const target = workshopTarget(v37);
  const steps = planAndroid({ ...complete, avds: ["Pixel_9_API_37_0", "Workshop_1_Pixel_10_API_37_0"] }, target);
  const avds = steps.find((s) => s.id === "avds")!;
  assert.equal(avds.done, false);
  assert.equal(avds.required, true);
  assert.equal(avds.title, "2 emulators");
  assert.match(avds.description, /Workshop_2_Pixel_10_API_37_0/);
  assert.doesNotMatch(avds.description, /Workshop_1/);

  assert.equal(planAndroid(bare, target).find((s) => s.id === "env")!.required, true);
  const both = planAndroid({ ...complete, avds: target.avds.map((a) => a.name) }, target);
  assert.equal(both.find((s) => s.id === "avds")!.done, true);
  assert.equal(both.find((s) => s.id === "env")!.required, true);
});

test("packages that are already installed are not asked again", () => {
  const state: Inspection = { ...complete, avds: [], installedPackages: new Set(ALL_PACKAGES) };
  const steps = planAndroid(state, defaultTarget(v37));
  assert.equal(steps.find((s) => s.id === "packages")!.done, true);
  assert.equal(steps.find((s) => s.id === "avds")!.done, false);
});

// ─── doing the steps ────────────────────────────────────────────────────────

test("a bare machine is set up step by step, each step using what the one before it produced", async () => {
  const steps = planAndroid(bare, defaultTarget(v37));
  for (const step of steps) assert.equal(await step.apply(), true, step.id);

  assert.equal(installJdk.mock.callCount(), 1);
  assert.deepEqual(installCmdlineTools.mock.calls[0]!.arguments, ["/sdk"]);
  assert.deepEqual(acceptLicenses.mock.calls[0]!.arguments, ["/sdk", "/downloaded/jdk"]);
  const [, , packages] = installPackages.mock.calls[0]!.arguments;
  assert.equal(packages.length, 4);
  assert.deepEqual(installSkin.mock.calls[0]!.arguments, ["/sdk", "pixel_9"]);
  assert.equal((createAvd.mock.calls[0]!.arguments[2] as { name: string }).name, "Pixel_9_API_37_0");
  assert.deepEqual(persistEnv.mock.calls[0]!.arguments[0], {
    vars: { ANDROID_HOME: "/sdk", JAVA_HOME: "/downloaded/jdk" },
    paths: [join("/sdk", "platform-tools"), join("/sdk", "emulator")],
  });
  assert.equal(applyToProcess.mock.callCount(), 1);
});

test("a dry run says what it would do and changes nothing", async () => {
  settings.dryRun = true;
  for (const step of planAndroid(bare, defaultTarget(v37))) assert.equal(await step.apply(), true, step.id);

  for (const fn of [installJdk, installCmdlineTools, installPackages, createAvd, persistEnv]) assert.equal(fn.mock.callCount(), 0);
  const text = output.join("\n");
  assert.match(text, /\[dry run\] would download Java 21/);
  assert.match(text, /would accept the licenses and install: platform-tools, emulator/);
  assert.match(text, /would download the device skin and create Pixel_9_API_37_0/);
});

test("a failed Java download tells the user what else they can do", async () => {
  installJdk.mock.mockImplementation(async () => {
    throw new Error("offline");
  });
  const [javaStep] = planAndroid(bare, defaultTarget(v37));
  assert.equal(await javaStep!.apply(), false);
  assert.match(output.join("\n"), /Downloading Java failed: offline[\s\S]*adoptium\.net/);
});

test("a failed download of the command-line tools stops the step", async () => {
  installCmdlineTools.mock.mockImplementation(async () => {
    throw new Error("HTTP 503");
  });
  const tools = planAndroid(bare, defaultTarget(v37))[1]!;
  assert.equal(await tools.apply(), false);
});

test("packages and emulators say what they need first when Java or the tools are not there", async () => {
  const [, , packages, avds] = planAndroid(bare, defaultTarget(v37));
  assert.equal(await packages!.apply(), false);
  assert.equal(await avds!.apply(), false);
  assert.equal(installPackages.mock.callCount(), 0);
  assert.match(output.join("\n"), /need Java and the command-line tools first/);
});

test("a failing license or package install is reported", async () => {
  const state: Inspection = { ...bare, java, toolsReady: true };
  const packages = planAndroid(state, defaultTarget(v37)).find((s) => s.id === "packages")!;
  installPackages.mock.mockImplementation(() => false);
  assert.equal(await packages.apply(), false);
  acceptLicenses.mock.mockImplementation(() => false);
  assert.equal(await packages.apply(), false);
});

test("a skin that cannot be downloaded is only a warning, a failed emulator is an error", async () => {
  const state: Inspection = { ...bare, java, toolsReady: true };
  const avds = planAndroid(state, defaultTarget(v37)).find((s) => s.id === "avds")!;
  installSkin.mock.mockImplementation(async () => {
    throw new Error("HTTP 500");
  });
  assert.equal(await avds.apply(), true);
  assert.match(output.join("\n"), /without a device frame/);

  createAvd.mock.mockImplementation(() => ({ output: "boom", exitCode: 1 }));
  assert.equal(await avds.apply(), false);
  assert.match(output.join("\n"), /Creating Pixel_9_API_37_0 failed[\s\S]*boom/);
});

test("named emulators are all created with the given skin, downloading it once", async () => {
  const state: Inspection = { ...bare, java, toolsReady: true };
  const avds = planAndroid(state, workshopTarget(v37)).find((s) => s.id === "avds")!;
  assert.equal(await avds.apply(), true);
  assert.equal(installSkin.mock.callCount(), 1);
  assert.deepEqual(installSkin.mock.calls[0]!.arguments, ["/sdk", "pixel_10"]);
  assert.deepEqual(createAvd.mock.calls.map((c) => (c.arguments[2] as { name: string }).name), ["Workshop_1_Pixel_10_API_37_0", "Workshop_2_Pixel_10_API_37_0"]);
});

test("a skin that is already there is not downloaded again", async () => {
  hasSkin.mock.mockImplementation(() => true);
  const state: Inspection = { ...bare, java, toolsReady: true };
  await planAndroid(state, defaultTarget(v37)).find((s) => s.id === "avds")!.apply();
  assert.equal(installSkin.mock.callCount(), 0);
});

test("a failing environment write is reported", async () => {
  persistEnv.mock.mockImplementation(() => {
    throw new Error("read-only profile");
  });
  const env = planAndroid(bare, defaultTarget(v37)).find((s) => s.id === "env")!;
  assert.equal(await env.apply(), false);
  assert.match(output.join("\n"), /read-only profile/);
  persistEnv.mock.mockImplementation(() => "~/.zshrc");
});
