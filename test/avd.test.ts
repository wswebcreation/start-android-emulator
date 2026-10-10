import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, mock, test } from "node:test";

const skipOnWindows = { skip: process.platform === "win32" && "paths and executables differ on Windows" };
const result = (output = "", exitCode = 0) => ({ output, exitCode });
type RunFileArgs = [string, string[], { input?: string }];

const runFile = mock.fn((_file: string, _args?: string[], _options?: object) => result());
const download = mock.fn(async (..._args: unknown[]) => {});
const extractArchive = mock.fn(async (_archive: string, _dir: string) => {});
mock.module("../src/shell.ts", { namedExports: { IS_MAC: process.platform === "darwin", IS_WIN: process.platform === "win32", run: () => null, runFile } });
mock.module("../src/download.ts", { namedExports: { download, extractArchive } });
const avd = await import("../src/android/avd.ts");
const { abi } = await import("../src/android/versions.ts");

const root = mkdtempSync(join(tmpdir(), "start-android-emulator-avd-"));
after(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  for (const fn of [runFile, download, extractArchive]) fn.mock.resetCalls();
  runFile.mock.mockImplementation(() => result());
});

const touch = (file: string) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, "");
  return file;
};
const fakeSdk = (name: string) => {
  const sdk = join(root, name);
  touch(join(sdk, "cmdline-tools", "latest", "bin", "avdmanager"));
  return sdk;
};
const v37 = { api: "37.0", label: "Android 17 (API 37.0)" };
const v36 = { api: "36", label: "Android 16 (API 36)" };

test("emulators are named like Android Studio does, and a given name gets the version filled in", () => {
  assert.equal(avd.avdName(v37), "Pixel_9_API_37_0");
  assert.equal(avd.avdName(v36), "Pixel_9_API_36");
  assert.equal(avd.expandName("Test_{api}_a", v37), "Test_37_0_a");
  assert.equal(avd.expandName("Test_{api}_{api}", v36), "Test_36_36");
  assert.equal(avd.expandName("Fixed", v36), "Fixed");
});

test("listAvds returns emulator names and ignores warning lines", skipOnWindows, () => {
  runFile.mock.mockImplementation(() => result("WARNING: A Java warning with spaces\nPixel_9_API_37_0\n\nPixel_8_API_35\n"));
  assert.deepEqual(avd.listAvds(fakeSdk("avd-sdk"), "/jdk"), ["Pixel_9_API_37_0", "Pixel_8_API_35"]);
});

test("listAvds is null without avdmanager or when it fails", skipOnWindows, () => {
  assert.equal(avd.listAvds(join(root, "no-tools"), "/jdk"), null);
  runFile.mock.mockImplementation(() => result("", 1));
  assert.equal(avd.listAvds(fakeSdk("avd-failing-sdk"), "/jdk"), null);
});

test("the device skin is only there when its layout file is", skipOnWindows, async () => {
  const sdk = join(root, "skin-sdk");
  assert.equal(avd.hasSkin(sdk, "pixel_9"), false);

  extractArchive.mock.mockImplementation(async (_archive, dir) => {
    touch(join(dir, "layout"));
  });
  await avd.installSkin(sdk, "pixel_9");
  assert.match(download.mock.calls[0]!.arguments[0] as string, /device-art-resources\/pixel_9\.tar\.gz$/);
  assert.equal(avd.hasSkin(sdk, "pixel_9"), true);
  assert.equal(avd.hasSkin(sdk, "pixel_10"), false, "a skin is per device");
});

test("installSkin fails when the archive has no layout file", skipOnWindows, async () => {
  extractArchive.mock.mockImplementation(async (_archive, dir) => {
    mkdirSync(dir, { recursive: true });
  });
  await assert.rejects(avd.installSkin(join(root, "skin-sdk-empty"), "pixel_10"), /pixel_10\/layout is missing/);
});

test("createAvd creates the emulator from the system image of the version, with the skin when we have it", skipOnWindows, () => {
  const sdk = fakeSdk("create-sdk");
  touch(join(sdk, "skins", "pixel_9", "layout"));

  assert.equal(avd.createAvd(sdk, "/jdk", { name: "Pixel_9_API_37_0", version: v37 }).exitCode, 0);
  const [, args, options] = runFile.mock.calls[0]!.arguments as RunFileArgs;
  assert.deepEqual(args, ["create", "avd", "--force", "-n", "Pixel_9_API_37_0", "-k", `system-images;android-37.0;google_apis;${abi()}`, "-d", "pixel_9", "--skin", "pixel_9"]);
  assert.equal(options.input, "no\n");
});

test("createAvd leaves the skin out when it is not installed, and uses the device of a preset", skipOnWindows, () => {
  const sdk = fakeSdk("create-sdk-no-skin");
  avd.createAvd(sdk, "/jdk", { name: "Workshop_1", version: v36, device: { profile: "pixel_9", skin: "pixel_10" } });
  const [, args] = runFile.mock.calls[0]!.arguments as RunFileArgs;
  assert.ok(!args.includes("--skin"));
  assert.equal(args[args.indexOf("-d") + 1], "pixel_9");
});

test("createAvd fails clearly without avdmanager", skipOnWindows, () => {
  const result = avd.createAvd(join(root, "no-tools"), "/jdk", { name: "x", version: v37 });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /avdmanager was not found/);
  assert.equal(runFile.mock.callCount(), 0);
});
