import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { download, extractArchive } from "../download.ts";
import { runFile, type RunResult } from "../shell.ts";
import { sdkTool, toolEnv } from "./sdk.ts";
import { abi, systemImage, type AndroidVersion } from "./versions.ts";

export interface DeviceProfile {
  /** The hardware profile of avdmanager, like "pixel_9" */
  profile: string;
  /** The device frame around the screen, like "pixel_9" */
  skin: string;
}

export const DEFAULT_DEVICE: DeviceProfile = { profile: "pixel_9", skin: "pixel_9" };

/**
 * The workshop needs two emulators, both Pixel 10. avdmanager has no pixel_10 hardware profile yet, but the screen is
 * identical to the Pixel 9 (1080x2424), so we use the pixel_9 profile with the Pixel 10 skin.
 */
export const WORKSHOP_DEVICE: DeviceProfile = { profile: "pixel_9", skin: "pixel_10" };

const apiSuffix = (version: AndroidVersion) => `API_${version.api.replace(".", "_")}`;

/** Pixel_9_API_37_0, the same name Android Studio would give it. */
export const avdName = (version: AndroidVersion, device: DeviceProfile = DEFAULT_DEVICE) =>
  `${device.skin.charAt(0).toUpperCase()}${device.skin.slice(1)}_${apiSuffix(version)}`;

export const workshopAvdNames = (version: AndroidVersion) =>
  [1, 2].map((n) => `Workshop_${n}_${avdName(version, WORKSHOP_DEVICE)}`);

// The emulator only shows a device frame when a skin is available in <sdk>/skins. Android Studio copies these
// there, without Studio they are missing, so fetch the same files from the Android source tree.
const skinUrl = (skin: string) =>
  `https://android.googlesource.com/platform/tools/adt/idea/+archive/refs/heads/mirror-goog-studio-main/artwork/resources/device-art-resources/${skin}.tar.gz`;

export const hasSkin = (sdk: string, skin: string) => existsSync(join(sdk, "skins", skin, "layout"));

export async function installSkin(sdk: string, skin: string): Promise<void> {
  const archive = join(sdk, "skins", `${skin}.tar.gz`);
  await download(skinUrl(skin), archive, "Downloading emulator skin");
  await extractArchive(archive, join(sdk, "skins", skin));
  await rm(archive, { force: true });
  if (!hasSkin(sdk, skin)) throw new Error(`Skin was downloaded but ${skin}/layout is missing`);
}

/** The names of the emulators that exist, or null when avdmanager is missing or fails. */
export function listAvds(sdk: string, jdk: string): string[] | null {
  const avdmanager = sdkTool(sdk, "avdmanager");
  if (!avdmanager) return null;
  const { output, exitCode } = runFile(avdmanager, ["list", "avd", "-c"], { env: toolEnv(sdk, jdk) });
  if (exitCode !== 0) return null;
  // avdmanager prints a Java warning line on some setups, AVD names never contain spaces
  return output.split("\n").map((l) => l.trim()).filter((l) => l && !/\s/.test(l));
}

export interface CreateAvdOptions {
  name: string;
  version: AndroidVersion;
  device?: DeviceProfile;
}

export function createAvd(sdk: string, jdk: string, { name, version, device = DEFAULT_DEVICE }: CreateAvdOptions): RunResult {
  const avdmanager = sdkTool(sdk, "avdmanager");
  if (!avdmanager) return { output: "avdmanager was not found, the command-line tools are not installed", exitCode: 1 };
  const skin = hasSkin(sdk, device.skin) ? ["--skin", device.skin] : [];
  return runFile(avdmanager, ["create", "avd", "--force", "-n", name, "-k", systemImage(version, abi()), "-d", device.profile, ...skin], {
    env: toolEnv(sdk, jdk),
    input: "no\n", // "Do you wish to create a custom hardware profile?"
  });
}
