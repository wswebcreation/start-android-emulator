import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, before, test } from "node:test";
import { applyToProcess, persistEnv, shellProfile } from "../src/env.ts";

const skipOnWindows = { skip: process.platform === "win32" && "writes to a shell profile, Windows uses user variables" };
let home: string;
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, SHELL: process.env.SHELL, PATH: process.env.PATH };

before(() => {
  home = mkdtempSync(join(tmpdir(), "start-android-emulator-env-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home; // Windows reads the home folder from here
  process.env.SHELL = "/bin/zsh";
});
after(() => {
  Object.assign(process.env, saved);
  rmSync(home, { recursive: true, force: true });
});

test("writes one managed block and rewrites it on the next run", skipOnWindows, () => {
  persistEnv({ vars: { ANDROID_HOME: "/sdk" }, paths: ["/sdk/platform-tools"] });
  persistEnv({ vars: { ANDROID_HOME: "/sdk2" }, paths: [] });
  const content = readFileSync(shellProfile(), "utf8");
  assert.equal(content.match(/>>> start-android-emulator >>>/g)?.length, 1);
  assert.match(content, /export ANDROID_HOME="\/sdk2"/);
  assert.doesNotMatch(content, /\/sdk\/platform-tools/);
});

test("applyToProcess sets variables and adds a PATH entry only once", () => {
  applyToProcess({ vars: { EMULATOR_TEST: "1" }, paths: ["/emulator/bin"] });
  applyToProcess({ paths: ["/emulator/bin"] });
  assert.equal(process.env.EMULATOR_TEST, "1");
  assert.equal((process.env.PATH ?? "").split(delimiter).filter((p) => p === "/emulator/bin").length, 1);
  delete process.env.EMULATOR_TEST;
});

test("keeps what is already in the profile, also when it does not end with a newline", skipOnWindows, () => {
  const profile = shellProfile();
  rmSync(profile, { force: true });
  writeFileSync(profile, "export EDITOR=vim");
  persistEnv({ vars: { JAVA_HOME: "/jdk" }, paths: [] });
  const content = readFileSync(profile, "utf8");
  assert.ok(content.startsWith("export EDITOR=vim\n"));
  assert.match(content, /export JAVA_HOME="\/jdk"/);
});

test("uses .bashrc on Linux with bash, and .zshrc on a Mac or with zsh", skipOnWindows, () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.SHELL = "/bin/bash";
    assert.equal(shellProfile(), join(home, ".bashrc"));
    process.env.SHELL = "/usr/bin/zsh";
    assert.equal(shellProfile(), join(home, ".zshrc"));
    process.env.SHELL = "/bin/bash";
    Object.defineProperty(process, "platform", { value: "darwin" });
    assert.equal(shellProfile(), join(home, ".zshrc"));
  } finally {
    Object.defineProperty(process, "platform", platform);
    process.env.SHELL = "/bin/zsh";
  }
});

test("a separate block does not overwrite the default one", skipOnWindows, () => {
  persistEnv({ vars: { ANDROID_HOME: "/sdk" } });
  persistEnv({ paths: ["/other/bin"], block: "other step" });
  persistEnv({ paths: ["/other/bin2"], block: "other step" });
  const content = readFileSync(shellProfile(), "utf8");
  assert.match(content, /export ANDROID_HOME="\/sdk"/);
  assert.match(content, /\/other\/bin2/);
  assert.doesNotMatch(content, /\/other\/bin"/);
});
