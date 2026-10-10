import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { configFile, readConfig, writeConfig } from "../src/config.ts";

const root = mkdtempSync(join(tmpdir(), "start-android-emulator-config-"));
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, APPDATA: process.env.APPDATA };

beforeEach(() => {
  rmSync(join(root, "config"), { recursive: true, force: true });
  process.env.HOME = root;
  process.env.USERPROFILE = root; // Windows reads the home folder from here
  process.env.XDG_CONFIG_HOME = join(root, "config");
  process.env.APPDATA = join(root, "config");
});
after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

test("the settings live in a folder of their own in the config folder", () => {
  assert.equal(configFile(), join(root, "config", "start-android-emulator", "config.json"));
});

test("without a file there is nothing remembered", () => {
  assert.deepEqual(readConfig(), {});
});

test("what is written is read back, and a new write adds to it", () => {
  writeConfig({ lastEmulator: "Pixel_9_API_37_0" });
  writeConfig({ dns: false });
  assert.deepEqual(readConfig(), { lastEmulator: "Pixel_9_API_37_0", dns: false });
});

test("a key set to undefined is forgotten", () => {
  writeConfig({ lastEmulator: "A", dns: "1.1.1.1" });
  writeConfig({ dns: undefined });
  assert.deepEqual(readConfig(), { lastEmulator: "A" });
  assert.equal(JSON.parse(readFileSync(configFile(), "utf8")).dns, undefined);
});

test("a broken or unexpected file is the same as an empty one", () => {
  mkdirSync(dirname(configFile()), { recursive: true });
  for (const content of ["{not json", "42", "null", '{"lastEmulator": 5, "dns": true, "other": 1}']) {
    writeFileSync(configFile(), content);
    assert.deepEqual(readConfig(), {}, content);
  }
});

test("not being able to write is not an error", () => {
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "start-android-emulator"), "this is a file, so the folder cannot be made");
  assert.doesNotThrow(() => writeConfig({ lastEmulator: "A" }));
});
