import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, mock, test } from "node:test";

const skipOnWindows = { skip: process.platform === "win32" && "paths and executables differ on Windows" };
const IS_MAC = process.platform === "darwin";
const result = (output = "", exitCode = 0) => ({ output, exitCode });

type RunFileArgs = [string, string[], { input?: string; inherit?: boolean }];

const run = mock.fn((_cmd: string): string | null => null);
const runFile = mock.fn((_file: string, _args?: string[], _options?: object) => result());
const download = mock.fn(async (..._args: unknown[]) => {});
const extractArchive = mock.fn(async (_archive: string, _dir: string) => {});
mock.module("../src/shell.ts", { namedExports: { IS_MAC, IS_WIN: process.platform === "win32", run, runFile } });
mock.module("../src/download.ts", { namedExports: { download, extractArchive } });

const root = mkdtempSync(join(tmpdir(), "start-android-emulator-sdk-"));
const realHome = process.env.HOME;
process.env.HOME = join(root, "home");
const sdk = await import("../src/android/sdk.ts");

const touch = (file: string, content = "") => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
  return file;
};
const fakeJdk = (home: string, javaVersion: string) => {
  touch(join(home, "bin", "java"));
  versions.set(join(home, "bin", "java"), javaVersion);
  return home;
};
const versions = new Map<string, string>();
const fakeSdk = (name: string) => {
  const dir = join(root, name);
  touch(join(dir, "cmdline-tools", "latest", "bin", "sdkmanager"));
  touch(join(dir, "cmdline-tools", "latest", "bin", "avdmanager"));
  return dir;
};

const savedEnv = { ...process.env };
before(() => mkdirSync(process.env.HOME!, { recursive: true }));
after(() => {
  process.env.HOME = realHome;
  rmSync(root, { recursive: true, force: true });
});
beforeEach(() => {
  for (const fn of [run, runFile, download, extractArchive]) fn.mock.resetCalls();
  runFile.mock.mockImplementation((file) => (versions.has(file) ? result(`openjdk version "${versions.get(file)}" 2025`) : result()));
  for (const name of ["JAVA_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) delete process.env[name];
});
afterEach(() => {
  mock.restoreAll();
  Object.assign(process.env, savedEnv);
});

test("defaultSdkPath is the usual place for the operating system", skipOnWindows, () => {
  const expected = IS_MAC ? join(process.env.HOME!, "Library", "Android", "sdk") : join(process.env.HOME!, "Android", "Sdk");
  assert.equal(sdk.defaultSdkPath(), expected);
});

test("detectSdkPath prefers ANDROID_HOME, then a SDK in a known place, else null", skipOnWindows, () => {
  assert.equal(sdk.detectSdkPath(), null);

  mkdirSync(join(sdk.defaultSdkPath(), "platform-tools"), { recursive: true });
  assert.equal(sdk.detectSdkPath(), sdk.defaultSdkPath());

  process.env.ANDROID_HOME = "/does/not/exist";
  assert.equal(sdk.detectSdkPath(), sdk.defaultSdkPath());

  process.env.ANDROID_HOME = join(root, "custom-sdk");
  mkdirSync(process.env.ANDROID_HOME);
  assert.equal(sdk.detectSdkPath(), process.env.ANDROID_HOME);

  delete process.env.ANDROID_HOME;
  process.env.ANDROID_SDK_ROOT = process.env.HOME;
  assert.equal(sdk.detectSdkPath(), process.env.HOME);
});

const osName = IS_MAC ? "mac" : process.platform === "win32" ? "win" : "linux";
const repositoryXml = (os: string) =>
  [`commandlinetools-${os}-9477386_latest.zip`, `commandlinetools-${os}-13114758_latest.zip`, "commandlinetools-other-99999999_latest.zip"].join("\n");
const fakeFetch = (response: { ok: boolean; status?: number; text?: () => Promise<string> }) =>
  mock.method(globalThis, "fetch", async () => response as Response);

test("installCmdlineTools downloads the newest build for this OS into cmdline-tools/latest", skipOnWindows, async () => {
  fakeFetch({ ok: true, text: async () => repositoryXml(osName) });
  extractArchive.mock.mockImplementation(async (_zip, out) => {
    touch(join(out, "cmdline-tools", "bin", "sdkmanager"));
  });
  const dir = join(root, "new-sdk");

  await sdk.installCmdlineTools(dir);

  assert.equal(download.mock.calls[0]!.arguments[0], `https://dl.google.com/android/repository/commandlinetools-${osName}-13114758_latest.zip`);
  assert.ok(existsSync(join(dir, "cmdline-tools", "latest", "bin", "sdkmanager")));
  assert.equal(existsSync(join(dir, ".cmdline-tools-download")), false, "temporary download folder is removed");
});

test("installCmdlineTools explains what went wrong when it cannot find the tools", skipOnWindows, async () => {
  fakeFetch({ ok: false, status: 503 });
  await assert.rejects(sdk.installCmdlineTools(join(root, "sdk-a")), /HTTP 503/);
  fakeFetch({ ok: true, text: async () => "nothing useful" });
  await assert.rejects(sdk.installCmdlineTools(join(root, "sdk-b")), new RegExp(`No command-line tools found for ${osName}`));
});

test("sdkTool finds a tool in cmdline-tools/latest/bin, or null", skipOnWindows, () => {
  const dir = fakeSdk("tools-sdk");
  assert.equal(sdk.sdkTool(dir, "sdkmanager"), join(dir, "cmdline-tools", "latest", "bin", "sdkmanager"));
  assert.equal(sdk.sdkTool(dir, "nope"), null);
});

test("platformToolsDirs and toolEnv point at the SDK and the JDK", () => {
  assert.deepEqual(sdk.platformToolsDirs("/sdk"), [join("/sdk", "platform-tools"), join("/sdk", "emulator")]);
  const env = sdk.toolEnv("/sdk", "/jdk");
  assert.equal(env.ANDROID_HOME, "/sdk");
  assert.equal(env.JAVA_HOME, "/jdk");
});

const SDKMANAGER_LIST = `Installed packages:
  Path                 | Version | Description                  | Location
  -------              | ------- | -------                      | -------
  emulator             | 36.4.9  | Android Emulator             | emulator
  platform-tools       | 37.0.0  | Android SDK Platform-Tools   | platform-tools
  platforms;android-37.0 | 1     | Android SDK Platform 37.0    | platforms/android-37.0
`;

test("listInstalledPackages returns the package ids sdkmanager prints", skipOnWindows, () => {
  const dir = fakeSdk("list-sdk");
  runFile.mock.mockImplementation(() => result(SDKMANAGER_LIST));
  assert.deepEqual([...sdk.listInstalledPackages(dir, "/jdk")!].sort(), ["emulator", "platform-tools", "platforms;android-37.0"]);
  assert.deepEqual(runFile.mock.calls[0]!.arguments[1], [`--sdk_root=${dir}`, "--list_installed"]);
});

test("listInstalledPackages is null without sdkmanager or when it fails", skipOnWindows, () => {
  assert.equal(sdk.listInstalledPackages(join(root, "no-tools"), "/jdk"), null);
  runFile.mock.mockImplementation(() => result("boom", 1));
  assert.equal(sdk.listInstalledPackages(fakeSdk("failing-sdk"), "/jdk"), null);
});

test("acceptLicenses answers yes to every question", skipOnWindows, () => {
  runFile.mock.mockImplementation(() => result());
  assert.equal(sdk.acceptLicenses(fakeSdk("licence-sdk"), "/jdk"), true);
  assert.match((runFile.mock.calls[0]!.arguments as RunFileArgs)[2].input!, /^(y\n)+$/);
  runFile.mock.mockImplementation(() => result("", 1));
  assert.equal(sdk.acceptLicenses(fakeSdk("licence-sdk"), "/jdk"), false);
});

test("installPackages installs the given packages and shows the progress", skipOnWindows, () => {
  const dir = fakeSdk("install-sdk");
  runFile.mock.mockImplementation(() => result());
  assert.equal(sdk.installPackages(dir, "/jdk", ["emulator", "platform-tools"]), true);
  const [, args, options] = runFile.mock.calls[0]!.arguments as RunFileArgs;
  assert.deepEqual(args, [`--sdk_root=${dir}`, "--install", "emulator", "platform-tools"]);
  assert.equal(options.inherit, true);
  runFile.mock.mockImplementation(() => result("", 1));
  assert.equal(sdk.installPackages(dir, "/jdk", ["emulator"]), false);
});

test("licenses and packages report failure instead of crashing when sdkmanager is missing", skipOnWindows, () => {
  assert.equal(sdk.acceptLicenses(join(root, "no-tools"), "/jdk"), false);
  assert.equal(sdk.installPackages(join(root, "no-tools"), "/jdk", ["emulator"]), false);
  assert.equal(runFile.mock.callCount(), 0);
});

test("the SDK manager gets the proxy from the environment as options", skipOnWindows, () => {
  const dir = fakeSdk("proxy-sdk");
  runFile.mock.mockImplementation(() => result());
  process.env.HTTPS_PROXY = "http://proxy.company.com:8080";
  sdk.installPackages(dir, "/jdk", ["emulator"]);
  sdk.acceptLicenses(dir, "/jdk");
  const proxy = ["--proxy=http", "--proxy_host=proxy.company.com", "--proxy_port=8080"];
  assert.deepEqual(runFile.mock.calls[0]!.arguments[1], [`--sdk_root=${dir}`, ...proxy, "--install", "emulator"]);
  assert.deepEqual(runFile.mock.calls[1]!.arguments[1], [`--sdk_root=${dir}`, ...proxy, "--licenses"]);
});

test("androidEnvGaps lists what the terminal is missing", skipOnWindows, () => {
  run.mock.mockImplementation(() => null);
  assert.deepEqual(sdk.androidEnvGaps(), { vars: ["ANDROID_HOME", "JAVA_HOME"], pathMissing: true });

  process.env.ANDROID_HOME = "/sdk";
  process.env.JAVA_HOME = fakeJdk(join(root, "gaps-old"), "1.8.0_1");
  assert.deepEqual(sdk.androidEnvGaps().vars, ["JAVA_HOME"], "Java 8 is too old");

  process.env.JAVA_HOME = fakeJdk(join(root, "gaps-new"), "21.0.1");
  run.mock.mockImplementation(() => "Android Debug Bridge version 1.0.41");
  assert.deepEqual(sdk.androidEnvGaps(), { vars: [], pathMissing: false });
});
