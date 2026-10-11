import assert from "node:assert/strict";
import { test } from "node:test";
import { splitUpdates, unusedPackages } from "../src/android/maintain.ts";
import { imageFromSysdir } from "../src/android/avd.ts";
import { parseUpdates } from "../src/android/sdk.ts";

const IMG37 = "system-images;android-37.0;google_apis;arm64-v8a";
const IMG35 = "system-images;android-35;google_apis_playstore;arm64-v8a";

test("the system image of an emulator is read from its sysdir line", () => {
  assert.equal(imageFromSysdir("system-images/android-37.0/google_apis/arm64-v8a/"), IMG37);
  assert.equal(imageFromSysdir("system-images\\android-35\\google_apis_playstore\\arm64-v8a\\"), IMG35);
});

test("unused packages are the system images no emulator uses, and the platforms and sources of versions without an emulator", () => {
  const installed = [
    "emulator", "build-tools;36.0.0", "ndk;27.1.12297006",
    IMG37, IMG35, "system-images;android-30;google_apis;arm64-v8a",
    "platforms;android-37.0", "platforms;android-30", "sources;android-30", "sources;android-37.0",
  ];
  assert.deepEqual(
    unusedPackages(installed, [IMG37, IMG35]).map((p) => [p.id, p.kind]),
    [["platforms;android-30", "platform"], ["sources;android-30", "sources"], ["system-images;android-30;google_apis;arm64-v8a", "image"]],
  );
});

test("without emulators every system image is unused", () => {
  assert.deepEqual(unusedPackages([IMG37, "emulator"], []).map((p) => p.id), [IMG37]);
});

test("updates are read from the Available Updates part of sdkmanager --list", () => {
  const output = [
    "Installed packages:", "  ID | Version", "  emulator | 37.2.12",
    "Available Packages:", "  platform-tools | 99 | x",
    "Available Updates:",
    "  ID                    | Installed | Available",
    "  -------               | -------   | -------",
    "  platform-tools        | 37.0.0    | 37.0.1",
    `  ${IMG35} | 8         | 9`,
    "",
  ].join("\n");
  assert.deepEqual(parseUpdates(output), [
    { id: "platform-tools", installed: "37.0.0", available: "37.0.1" },
    { id: IMG35, installed: "8", available: "9" },
  ]);
  assert.deepEqual(parseUpdates("Installed packages:\n  emulator | 1"), []);
});

test("updates are also read when the columns are separated by spaces and the ids have /", () => {
  const output = [
    "Installed packages:", "  emulator                 37.2.12      Android Emulator",
    "Available Updates:",
    "  platform-tools                                   37.0.0    37.0.1",
    "  system-images/android-35/google_apis_playstore/arm64-v8a   8         9",
    "",
  ].join("\n");
  assert.deepEqual(parseUpdates(output), [
    { id: "platform-tools", installed: "37.0.0", available: "37.0.1" },
    { id: IMG35, installed: "8", available: "9" },
  ]);
});

test("newer system images no emulator uses are not worth the download", () => {
  const updates = [
    { id: "platform-tools", installed: "1", available: "2" },
    { id: IMG35, installed: "8", available: "9" },
    { id: "system-images;android-30;google_apis;arm64-v8a", installed: "13", available: "16" },
  ];
  const { apply, skipped } = splitUpdates(updates, [IMG35]);
  assert.deepEqual(apply.map((u) => u.id), ["platform-tools", IMG35]);
  assert.deepEqual(skipped.map((u) => u.id), ["system-images;android-30;google_apis;arm64-v8a"]);
});
