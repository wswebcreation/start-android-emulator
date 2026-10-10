import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { FALLBACK_VERSIONS, fetchVersions, parseVersions, requiredPackages, resolveVersion, systemImage } from "../src/android/versions.ts";

const pkg = (path: string, channel = "channel-0") =>
  `<remotePackage path="${path}"><type-details/><channelRef ref="${channel}"/><archives/></remotePackage>`;

const XML = [
  pkg("system-images;android-37.0;google_apis;arm64-v8a"),
  pkg("system-images;android-37.0;google_apis;x86_64"),
  pkg("system-images;android-37.0;google_apis_ps16k;arm64-v8a"), // 16 KB page size, left out
  pkg("system-images;android-37.1;google_apis_ps16k;arm64-v8a"),
  pkg("system-images;android-37.2-beta1;google_apis;arm64-v8a", "channel-1"), // beta
  pkg("system-images;android-36-ext19;google_apis;arm64-v8a"), // duplicate of 36
  pkg("system-images;android-36.1;google_apis;arm64-v8a"),
  pkg("system-images;android-36;google_apis;arm64-v8a"),
  pkg("system-images;android-35;google_apis;arm64-v8a"),
  pkg("system-images;android-34;google_apis;x86_64"), // other CPU
  pkg("system-images;android-33;google_apis;arm64-v8a", "channel-3"), // canary
  pkg("system-images;android-32;google_apis;arm64-v8a"),
  pkg("system-images;android-99;google_apis;arm64-v8a"), // no release name known
].join("\n");

test("only stable Google APIs images for this CPU are listed, newest first", () => {
  const versions = parseVersions(XML, "arm64-v8a");
  assert.deepEqual(versions.map((v) => v.api), ["99", "37.0", "36.1", "36", "35", "32"]);
});

test("the other CPU gets its own list", () => {
  assert.deepEqual(parseVersions(XML, "x86_64").map((v) => v.api), ["37.0", "34"]);
});

test("versions are labelled with the Android release, or just the API when it is not known", () => {
  const labels = Object.fromEntries(parseVersions(XML, "arm64-v8a").map((v) => [v.api, v.label]));
  assert.equal(labels["37.0"], "Android 17 (API 37.0)");
  assert.equal(labels["36.1"], "Android 16 (API 36.1)");
  assert.equal(labels["32"], "Android 12L (API 32)");
  assert.equal(labels["99"], "API 99");
});

test("a listing without images gives an empty list", () => {
  assert.deepEqual(parseVersions("<nothing/>", "arm64-v8a"), []);
});

test("resolveVersion accepts 37 and 37.0, but not what we do not have", () => {
  const versions = parseVersions(XML, "arm64-v8a");
  assert.equal(resolveVersion("37.0", versions).api, "37.0");
  assert.equal(resolveVersion("37", versions).api, "37.0");
  assert.equal(resolveVersion(" 36 ", versions).api, "36", "36 and 36.1 are different versions");
  assert.throws(() => resolveVersion("12", versions), /"12" is not available\. Choose one of: 99, 37\.0, 36\.1, 36, 35, 32/);
});

test("requiredPackages names the platform and the system image of the version", () => {
  const [version] = parseVersions(XML, "arm64-v8a").filter((v) => v.api === "37.0");
  assert.deepEqual(requiredPackages(version!, "arm64-v8a"), [
    "platform-tools",
    "emulator",
    "platforms;android-37.0",
    "system-images;android-37.0;google_apis;arm64-v8a",
  ]);
  assert.equal(systemImage(version!, "x86_64"), "system-images;android-37.0;google_apis;x86_64");
});

test("fetchVersions reads Google's listing", () => {
  mock.method(globalThis, "fetch", async () => ({ ok: true, text: async () => XML }) as Response);
  return fetchVersions("arm64-v8a").then(({ versions, source }) => {
    mock.restoreAll();
    assert.equal(source, "live");
    assert.equal(versions[1]!.api, "37.0");
  });
});

test("fetchVersions falls back to the built-in list when the listing cannot be read", async () => {
  for (const response of [
    async () => ({ ok: false, status: 503 }) as Response,
    async () => ({ ok: true, text: async () => "<nothing/>" }) as Response,
    async () => {
      throw new Error("offline");
    },
  ]) {
    mock.method(globalThis, "fetch", response);
    const list = await fetchVersions("arm64-v8a");
    mock.restoreAll();
    assert.equal(list.source, "built-in");
    assert.equal(list.versions, FALLBACK_VERSIONS);
  }
});
