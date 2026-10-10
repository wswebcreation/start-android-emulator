import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { arch, tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, mock, test } from "node:test";

const skipOnWindows = { skip: process.platform === "win32" && "uses unix paths" };
const IS_MAC = process.platform === "darwin";
const result = (output = "", exitCode = 0) => ({ output, exitCode });

const runFile = mock.fn((_file: string, _args?: string[]) => result());
const download = mock.fn(async (..._args: unknown[]) => {});
const extractArchive = mock.fn(async (_archive: string, _dir: string) => {});
mock.module("../src/shell.ts", { namedExports: { IS_MAC, IS_WIN: process.platform === "win32", runFile } });
mock.module("../src/download.ts", { namedExports: { download, extractArchive } });
const { MIN_JAVA, detectJava, installJdk, isValidJavaHome, javaMajor } = await import("../src/java.ts");

let root: string;
const saved = { HOME: process.env.HOME, JAVA_HOME: process.env.JAVA_HOME };
const versions = new Map<string, string>();

/** A fake JDK folder: bin/java exists, and the mocked `java -version` prints the given version. */
function fakeJdk(name: string, version: string): string {
  const home = join(root, name);
  mkdirSync(join(home, "bin"), { recursive: true });
  writeFileSync(join(home, "bin", "java"), "");
  versions.set(join(home, "bin", "java"), version);
  return home;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "start-android-emulator-java-"));
  process.env.HOME = root;
});
beforeEach(() => {
  versions.clear();
  delete process.env.JAVA_HOME;
  for (const fn of [runFile, download, extractArchive]) fn.mock.resetCalls();
  runFile.mock.mockImplementation((file) => (versions.has(file) ? result(`openjdk version "${versions.get(file)}" 2025`) : result()));
});
afterEach(() => rmSync(join(root, ".jdks"), { recursive: true, force: true }));
after(() => {
  Object.assign(process.env, saved);
  rmSync(root, { recursive: true, force: true });
});

test("javaMajor reads the major version, also from the old 1.x scheme", skipOnWindows, () => {
  assert.equal(javaMajor(fakeJdk("j21", "21.0.5")), 21);
  assert.equal(javaMajor(fakeJdk("j8", "1.8.0_392")), 8);
  assert.equal(javaMajor(fakeJdk("j17", "17")), 17);
});

test("javaMajor is null for output it does not understand or a folder without java", skipOnWindows, () => {
  const home = fakeJdk("odd", "21");
  runFile.mock.mockImplementation(() => result("something else"));
  assert.equal(javaMajor(home), null);
  assert.equal(javaMajor(join(root, "nothing")), null);
  assert.equal(javaMajor(undefined), null);
});

test("isValidJavaHome needs a bin/java", skipOnWindows, () => {
  assert.equal(isValidJavaHome(fakeJdk("valid", "21")), true);
  assert.equal(isValidJavaHome(root), false);
  assert.equal(isValidJavaHome(""), false);
});

test("detectJava uses JAVA_HOME when it is Java 17 or higher", skipOnWindows, () => {
  const home = fakeJdk("jh", "21.0.1");
  process.env.JAVA_HOME = home;
  assert.deepEqual(detectJava(), { home, major: 21, source: "JAVA_HOME" });
});

test("detectJava skips an old JAVA_HOME and uses the Java that was downloaded earlier", skipOnWindows, () => {
  process.env.JAVA_HOME = fakeJdk("old", "1.8.0_1");
  const top = join(root, ".jdks", "temurin-21", "jdk-21.0.5+11");
  const home = IS_MAC ? join(top, "Contents", "Home") : top;
  mkdirSync(join(home, "bin"), { recursive: true });
  writeFileSync(join(home, "bin", "java"), "");
  versions.set(join(home, "bin", "java"), "21.0.5");

  assert.deepEqual(detectJava(), { home, major: 21, source: "downloaded by setup" });
});

test("detectJava finds nothing when there is no usable Java", skipOnWindows, () => {
  assert.equal(detectJava(), null);
  process.env.JAVA_HOME = fakeJdk("tooold", `${MIN_JAVA - 1}.0.1`);
  assert.equal(detectJava(), null);
});

test("installJdk downloads Temurin 21 for this machine and returns its home", skipOnWindows, async () => {
  extractArchive.mock.mockImplementation(async (_archive, dir) => {
    const home = IS_MAC ? join(dir, "jdk-21.0.5+11", "Contents", "Home") : join(dir, "jdk-21.0.5+11");
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(join(home, "bin", "java"), "");
  });

  const home = await installJdk();
  const url = download.mock.calls[0]!.arguments[0] as string;
  const os = IS_MAC ? "mac" : "linux";
  const cpu = arch() === "arm64" ? "aarch64" : "x64";
  assert.equal(url, `https://api.adoptium.net/v3/binary/latest/21/ga/${os}/${cpu}/jdk/hotspot/normal/eclipse`);
  assert.ok(home.startsWith(join(root, ".jdks", "temurin-21")));
});

test("installJdk explains when the download does not contain a JDK", skipOnWindows, async () => {
  extractArchive.mock.mockImplementation(async (_archive, dir) => {
    mkdirSync(dir, { recursive: true });
  });
  await assert.rejects(installJdk(), /no JDK was found/);
});
