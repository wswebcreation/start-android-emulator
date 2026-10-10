import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";

// The Windows flavour of the helpers: other folders, .exe/.bat tools, zip downloads.
// Runs on every system, because the shell module is mocked to say it is Windows.
const run = mock.fn((_cmd: string): string | null => null);
const runFile = mock.fn((_file: string, _args?: string[]) => ({ output: 'openjdk version "21.0.2" 2025', exitCode: 0 }));
const download = mock.fn(async (..._args: unknown[]) => {});
const extractArchive = mock.fn(async (_archive: string, _dir: string) => {});
mock.module("../src/shell.ts", { namedExports: { IS_MAC: false, IS_WIN: true, run, runFile } });
mock.module("../src/download.ts", { namedExports: { download, extractArchive } });

const root = mkdtempSync(join(tmpdir(), "start-android-emulator-win-"));
const savedEnv = { ...process.env };
process.env.HOME = join(root, "home");
process.env.USERPROFILE = process.env.HOME; // Windows reads the home folder from here
const java = await import("../src/java.ts");
const sdk = await import("../src/android/sdk.ts");

const touch = (file: string) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, "");
};
after(() => {
  Object.assign(process.env, savedEnv);
  rmSync(root, { recursive: true, force: true });
});

test("the SDK lives in LOCALAPPDATA\\Android\\Sdk, or in the home folder without LOCALAPPDATA", () => {
  process.env.LOCALAPPDATA = join(root, "local");
  assert.equal(sdk.defaultSdkPath(), join(root, "local", "Android", "Sdk"));
  delete process.env.LOCALAPPDATA;
  assert.equal(sdk.defaultSdkPath(), join(homedir(), "Android", "Sdk"));
});

test("Java is java.exe, directly in the JDK folder (no Contents/Home like on a Mac)", async () => {
  assert.equal(java.isValidJavaHome(join(root, "jdk")), false);
  touch(join(root, "jdk", "bin", "java.exe"));
  assert.equal(java.isValidJavaHome(join(root, "jdk")), true);
  assert.equal(java.javaMajor(join(root, "jdk")), 21);

  extractArchive.mock.mockImplementation(async (_zip, dir) => touch(join(dir, "jdk-21.0.2+13", "bin", "java.exe")));
  const home = await java.installJdk();
  assert.match(download.mock.calls[0]!.arguments[0] as string, /\/ga\/windows\//);
  assert.match(download.mock.calls[0]!.arguments[1] as string, /temurin-21\.zip$/);
  assert.equal(home, join(homedir(), ".jdks", "temurin-21", "jdk-21.0.2+13"));
});

test("the SDK tools are .bat files and the emulator is an .exe", () => {
  const dir = join(root, "sdk");
  assert.equal(sdk.sdkTool(dir, "sdkmanager"), null);
  touch(join(dir, "cmdline-tools", "latest", "bin", "sdkmanager.bat"));
  assert.equal(sdk.sdkTool(dir, "sdkmanager"), join(dir, "cmdline-tools", "latest", "bin", "sdkmanager.bat"));

  assert.equal(sdk.emulatorBinary(dir), null);
  touch(join(dir, "emulator", "emulator.exe"));
  assert.equal(sdk.emulatorBinary(dir), join(dir, "emulator", "emulator.exe"));
});

test("the command-line tools are the Windows build", async () => {
  mock.method(globalThis, "fetch", async () =>
    ({ ok: true, text: async () => "commandlinetools-win-111_latest.zip commandlinetools-mac-999_latest.zip" }) as Response);
  extractArchive.mock.mockImplementation(async (_zip, out) => touch(join(out, "cmdline-tools", "bin", "sdkmanager.bat")));
  await sdk.installCmdlineTools(join(root, "new-sdk"));
  assert.match(download.mock.calls.at(-1)!.arguments[0] as string, /commandlinetools-win-111_latest\.zip$/);
  mock.restoreAll();
});
