import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

const java = { home: "/jdk", major: 21, source: "JAVA_HOME" as const };
const detectJava = mock.fn((): typeof java | null => java);
const detectSdkPath = mock.fn((): string | null => "/sdk");
const sdkTool = mock.fn((_sdk: string, _name: string): string | null => "/sdk/cmdline-tools/latest/bin/sdkmanager");
const emulatorBinary = mock.fn((_sdk: string): string | null => "/sdk/emulator/emulator");
const listInstalledPackages = mock.fn((_sdk: string, _jdk: string): Set<string> | null => new Set(["emulator"]));
const androidEnvGaps = mock.fn(() => ({ vars: [] as string[], pathMissing: false }));
const listEmulators = mock.fn((_sdk: string): string[] | null => ["Pixel_9_API_37_0"]);
const listAvds = mock.fn((_sdk: string, _jdk: string): string[] | null => ["FromAvdmanager"]);

mock.module("../src/java.ts", { namedExports: { detectJava } });
mock.module("../src/android/sdk.ts", {
  namedExports: { defaultSdkPath: () => "/default/sdk", detectSdkPath, sdkTool, emulatorBinary, listInstalledPackages, androidEnvGaps },
});
mock.module("../src/android/avd.ts", { namedExports: { listEmulators, listAvds } });
const { inspect } = await import("../src/android/inspect.ts");

beforeEach(() => {
  detectJava.mock.mockImplementation(() => java);
  detectSdkPath.mock.mockImplementation(() => "/sdk");
  sdkTool.mock.mockImplementation(() => "/sdk/cmdline-tools/latest/bin/sdkmanager");
  emulatorBinary.mock.mockImplementation(() => "/sdk/emulator/emulator");
  listInstalledPackages.mock.mockImplementation(() => new Set(["emulator"]));
  listEmulators.mock.mockImplementation(() => ["Pixel_9_API_37_0"]);
  listAvds.mock.resetCalls();
});

test("a complete machine is reported as it is", async () => {
  assert.deepEqual(await inspect(), {
    sdk: "/sdk",
    sdkFound: true,
    java,
    toolsReady: true,
    installedPackages: new Set(["emulator"]),
    emulatorReady: true,
    avds: ["Pixel_9_API_37_0"],
    env: { vars: [], pathMissing: false },
  });
});

test("without an SDK the default location is where we would put it", async () => {
  detectSdkPath.mock.mockImplementation(() => null);
  sdkTool.mock.mockImplementation(() => null);
  emulatorBinary.mock.mockImplementation(() => null);
  listEmulators.mock.mockImplementation(() => null);
  const state = await inspect();
  assert.equal(state.sdk, "/default/sdk");
  assert.equal(state.sdkFound, false);
  assert.equal(state.toolsReady, false);
  assert.equal(state.installedPackages, null, "we cannot ask sdkmanager when it is not there");
  assert.deepEqual(state.avds, []);
});

test("without Java we cannot ask sdkmanager, but the emulator still lists its emulators", async () => {
  detectJava.mock.mockImplementation(() => null);
  const state = await inspect();
  assert.equal(state.installedPackages, null);
  assert.deepEqual(state.avds, ["Pixel_9_API_37_0"]);
});

test("when the emulator program is missing avdmanager is asked for the emulators", async () => {
  listEmulators.mock.mockImplementation(() => null);
  assert.deepEqual((await inspect()).avds, ["FromAvdmanager"]);
  detectJava.mock.mockImplementation(() => null);
  assert.deepEqual((await inspect()).avds, [], "and without Java there is nobody to ask");
});
