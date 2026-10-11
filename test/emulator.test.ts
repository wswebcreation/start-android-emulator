import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, mock, test } from "node:test";

const skipOnWindows = { skip: process.platform === "win32" && "paths and executables differ on Windows" };
const result = (output = "", exitCode = 0) => ({ output, exitCode });

const runFile = mock.fn((_file: string, _args?: string[]) => result());
const spawn = mock.fn((..._args: unknown[]) => child);
const unref = mock.fn();
let child: EventEmitter & { unref: () => void };
mock.module("../src/shell.ts", { namedExports: { IS_MAC: process.platform === "darwin", IS_WIN: process.platform === "win32", run: () => null, runFile, runFileAsync: (file: string, args?: string[], options?: object) => Promise.resolve((runFile as (...a: unknown[]) => unknown)(file, args, options)) } });
mock.module("node:child_process", { namedExports: { spawn, spawnSync: () => ({ status: 0 }) } });
const emulator = await import("../src/android/emulator.ts");

const root = mkdtempSync(join(tmpdir(), "start-android-emulator-emulator-"));
after(() => rmSync(root, { recursive: true, force: true }));

const options = { name: "Pixel_9_API_37_0", wipeData: false, coldBoot: false, dns: "8.8.8.8" as string | false };
const noSleep = { sleep: async () => {}, intervalMs: 1000, timeoutMs: 5000 };

/**
 * What adb says: the given emulators are running, with their AVD name and whether they booted.
 * `console: false` is an emulator whose console prints nothing (no auth token), like the real one on the author's Mac.
 */
function adbSays(running: { serial: string; avd: string; booted: boolean; property?: boolean; console?: boolean }[]) {
  runFile.mock.mockImplementation((_file, args = []) => {
    if (args[0] === "devices") return result(`* daemon started successfully\nList of devices attached\n${running.map((r) => `${r.serial}\tdevice`).join("\n")}\n`);
    const device = running.find((r) => r.serial === args[1]);
    if (args.includes("ro.boot.qemu.avd_name")) return result(device?.property === false ? "" : `${device?.avd}\n`);
    if (args.includes("emu")) return result(device?.console === false ? "" : `${device?.avd}\r\nOK`);
    if (args.includes("sys.boot_completed")) return result(device?.booted ? "1\n" : "\n");
    return result();
  });
}

beforeEach(() => {
  runFile.mock.resetCalls();
  spawn.mock.resetCalls();
  unref.mock.resetCalls();
  child = Object.assign(new EventEmitter(), { unref });
  adbSays([]);
});

test("the emulator starts with the DNS server by default, and only wipes or cold boots when asked", () => {
  assert.deepEqual(emulator.emulatorArgs(options), ["-avd", "Pixel_9_API_37_0", "-dns-server", "8.8.8.8"]);
  assert.deepEqual(emulator.emulatorArgs({ ...options, dns: false }), ["-avd", "Pixel_9_API_37_0"]);
  assert.deepEqual(emulator.emulatorArgs({ ...options, wipeData: true, coldBoot: true, dns: "1.1.1.1" }), [
    "-avd", "Pixel_9_API_37_0", "-wipe-data", "-no-snapshot", "-dns-server", "1.1.1.1",
  ]);
  assert.equal(emulator.DEFAULT_DNS, "8.8.8.8");
});

test("findRunning matches the emulator by the AVD it runs, not by its port", () => {
  adbSays([
    { serial: "emulator-5554", avd: "Other_AVD", booted: true },
    { serial: "emulator-5556", avd: "Pixel_9_API_37_0", booted: false },
  ]);
  assert.deepEqual(emulator.findRunning("adb", "Pixel_9_API_37_0"), { serial: "emulator-5556", booted: false });
  assert.equal(emulator.findRunning("adb", "Not_Running"), null);
});

test("findRunning reads the name from the system property, so a silent emulator console does not matter", () => {
  adbSays([{ serial: "emulator-5554", avd: "Pixel_9_API_37_0", booted: true, console: false }]);
  assert.deepEqual(emulator.findRunning("adb", "Pixel_9_API_37_0"), { serial: "emulator-5554", booted: true });
});

test("findRunning falls back to the console while the system property is not there yet", () => {
  adbSays([{ serial: "emulator-5554", avd: "Pixel_9_API_37_0", booted: false, property: false }]);
  assert.deepEqual(emulator.findRunning("adb", "Pixel_9_API_37_0"), { serial: "emulator-5554", booted: false });
});

test("findRunning does not match an emulator whose name it cannot find", () => {
  adbSays([{ serial: "emulator-5554", avd: "Pixel_9_API_37_0", booted: true, property: false, console: false }]);
  assert.equal(emulator.findRunning("adb", "Pixel_9_API_37_0"), null);
});

test("findRunning ignores real devices and the adb start-up noise", () => {
  runFile.mock.mockImplementation((_file, args = []) =>
    args[0] === "devices" ? result("* daemon not running; starting now\nList of devices attached\nR58M123ABC\tdevice\n") : result());
  assert.equal(emulator.findRunning("adb", "Pixel_9_API_37_0"), null);
});

test("findRunning says when the emulator has booted", () => {
  adbSays([{ serial: "emulator-5554", avd: "Pixel_9_API_37_0", booted: true }]);
  assert.deepEqual(emulator.findRunning("adb", "Pixel_9_API_37_0"), { serial: "emulator-5554", booted: true });
});

test("launchEmulator starts the emulator detached, with its output in a file", skipOnWindows, () => {
  const sdk = join(root, "sdk");
  mkdirSync(join(sdk, "emulator"), { recursive: true });
  writeFileSync(join(sdk, "emulator", "emulator"), "");

  const launched = emulator.launchEmulator(sdk, options);

  const [file, args, spawnOptions] = spawn.mock.calls[0]!.arguments as [string, string[], { detached: boolean; stdio: unknown[]; env: NodeJS.ProcessEnv }];
  assert.equal(file, join(sdk, "emulator", "emulator"));
  assert.deepEqual(args, emulator.emulatorArgs(options));
  assert.equal(spawnOptions.detached, true);
  assert.equal(spawnOptions.stdio[0], "ignore");
  assert.equal(typeof spawnOptions.stdio[1], "number", "a file, not a pipe");
  assert.equal(spawnOptions.env.ANDROID_HOME, sdk);
  assert.equal(unref.mock.callCount(), 1, "we do not keep the emulator from ending our process");
  assert.ok(existsSync(launched.logFile));
  assert.match(launched.logFile, /start-android-emulator-Pixel_9_API_37_0\.log$/);
});

test("launchEmulator remembers that the emulator stopped, and why", skipOnWindows, () => {
  const sdk = join(root, "sdk");
  const launched = emulator.launchEmulator(sdk, options);
  assert.equal(launched.exited, null);
  child.emit("exit", 1);
  assert.deepEqual(launched.exited, { code: 1 });
  child.emit("error", new Error("spawn ENOENT"));
  assert.deepEqual(launched.exited, { code: null, error: "spawn ENOENT" });
});

test("launchEmulator fails clearly when the emulator is not installed", () => {
  assert.throws(() => emulator.launchEmulator(join(root, "empty-sdk"), options), /The emulator is not installed in/);
  assert.equal(spawn.mock.callCount(), 0);
});

test("waitForBoot returns when the emulator of the AVD has booted, and keeps asking until then", async () => {
  const launched = { logFile: join(root, "x.log"), exited: null };
  let asked = 0;
  runFile.mock.mockImplementation((_file, args = []) => {
    if (args[0] === "devices") return result("List of devices attached\nemulator-5554\tdevice\n");
    if (args.includes("ro.boot.qemu.avd_name")) return result("Pixel_9_API_37_0");
    if (args.includes("sys.boot_completed")) return result(++asked >= 3 ? "1" : "");
    return result();
  });
  assert.deepEqual(await emulator.waitForBoot("adb", "Pixel_9_API_37_0", launched, noSleep), { serial: "emulator-5554", booted: true });
  assert.equal(asked, 3);
});

test("waitForBoot fails with the end of the log when the emulator stops", async () => {
  const logFile = join(root, "stopped.log");
  writeFileSync(logFile, "line 1\nPANIC: Missing emulator engine program\n");
  const launched = { logFile, exited: { code: 1 } };
  await assert.rejects(emulator.waitForBoot("adb", "A", launched, noSleep), /stopped before it was ready \(exit code 1\)[\s\S]*PANIC: Missing emulator engine[\s\S]*full log is in/);
});

test("waitForBoot fails when the emulator cannot be started at all", async () => {
  const launched = { logFile: join(root, "none.log"), exited: { code: null, error: "spawn ENOENT" } };
  await assert.rejects(emulator.waitForBoot("adb", "A", launched, noSleep), /spawn ENOENT/);
});

test("waitForBoot gives up after the timeout", async () => {
  const launched = { logFile: join(root, "slow.log"), exited: null };
  await assert.rejects(emulator.waitForBoot("adb", "A", launched, { ...noSleep, timeoutMs: 120_000, intervalMs: 60_000 }), /did not finish booting within 2 minutes/);
});

test("waitForBoot notices an emulator that stops while we wait", async () => {
  const launched: { logFile: string; exited: { code: number | null } | null } = { logFile: join(root, "later.log"), exited: null };
  let sleeps = 0;
  const sleep = async () => {
    if (++sleeps === 2) launched.exited = { code: 139 };
  };
  await assert.rejects(emulator.waitForBoot("adb", "A", launched, { ...noSleep, sleep }), /exit code 139/);
});

test("followLog prints what is added to the file", async () => {
  const file = join(root, "follow.log");
  writeFileSync(file, "");
  const seen: string[] = [];
  const stop = emulator.followLog(file, (text) => seen.push(text), 10);
  writeFileSync(file, "first\n");
  await new Promise((r) => setTimeout(r, 60));
  writeFileSync(file, "first\nsecond\n");
  await new Promise((r) => setTimeout(r, 60));
  stop();
  assert.equal(seen.join(""), "first\nsecond\n");
  assert.equal(readFileSync(file, "utf8"), "first\nsecond\n");
});

test("lastLines gives the end of a file, and nothing for a file that is not there", () => {
  const file = join(root, "tail.log");
  writeFileSync(file, Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"));
  assert.equal(emulator.lastLines(file, 2), "line 29\nline 30");
  assert.equal(emulator.lastLines(join(root, "missing.log")), "");
});
