import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { download, extractArchive } from "../download.ts";
import { runFile, runFileAsync, type RunResult } from "../shell.ts";
import { emulatorBinary, sdkTool, toolEnv } from "./sdk.ts";
import { abi, systemImage, type AndroidVersion } from "./versions.ts";

export interface DeviceProfile {
  /** The hardware profile of avdmanager, like "pixel_9" */
  profile: string;
  /** The device frame around the screen, like "pixel_9" */
  skin: string;
}

export const DEFAULT_DEVICE: DeviceProfile = { profile: "pixel_9", skin: "pixel_9" };

const apiSuffix = (version: AndroidVersion) => `API_${version.api.replace(".", "_")}`;

/** Pixel_9_API_37_0, the same name Android Studio would give it. */
export const avdName = (version: AndroidVersion, device: DeviceProfile = DEFAULT_DEVICE) =>
  `${device.skin.charAt(0).toUpperCase()}${device.skin.slice(1)}_${apiSuffix(version)}`;

/** Fill in the version in a name given by the user: Pixel_API_{api} becomes Pixel_API_37_0. */
export const expandName = (template: string, version: AndroidVersion) => template.replaceAll("{api}", version.api.replace(".", "_"));

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
export async function listAvds(sdk: string, jdk: string): Promise<string[] | null> {
  const avdmanager = sdkTool(sdk, "avdmanager");
  if (!avdmanager) return null;
  const { output, exitCode } = await runFileAsync(avdmanager, ["list", "avd", "-c"], { env: toolEnv(sdk, jdk) });
  if (exitCode !== 0) return null;
  // avdmanager prints a Java warning line on some setups, AVD names never contain spaces
  return output.split("\n").map((l) => l.trim()).filter((l) => l && !/\s/.test(l));
}

/** The emulators the emulator program knows, without needing Java. Null when the emulator is not installed. */
export async function listEmulators(sdk: string): Promise<string[] | null> {
  const emulator = emulatorBinary(sdk);
  if (!emulator) return null;
  const { output, exitCode } = await runFileAsync(emulator, ["-list-avds"], { env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk } });
  if (exitCode !== 0) return null;
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

/** Delete an emulator, with its files. */
export async function deleteAvd(sdk: string, jdk: string, name: string): Promise<RunResult> {
  const avdmanager = sdkTool(sdk, "avdmanager");
  if (!avdmanager) return { output: "avdmanager was not found, the command-line tools are not installed", exitCode: 1 };
  return runFileAsync(avdmanager, ["delete", "avd", "-n", name], { env: toolEnv(sdk, jdk) });
}

/** The system image package of an emulator ("system-images;android-37.0;google_apis;arm64-v8a") from the line in its config.ini. */
export const imageFromSysdir = (sysdir: string): string => sysdir.trim().replaceAll("\\", "/").replace(/\/+$/, "").split("/").join(";");

const avdHomes = () => [process.env.ANDROID_AVD_HOME, process.env.ANDROID_USER_HOME && join(process.env.ANDROID_USER_HOME, "avd"), join(homedir(), ".android", "avd")].filter(Boolean) as string[];

/** The system image an emulator uses, or null when we cannot read its configuration. */
export function avdImage(name: string): string | null {
  for (const home of avdHomes()) {
    try {
      const ini = existsSync(join(home, `${name}.ini`)) ? readFileSync(join(home, `${name}.ini`), "utf8") : "";
      const folder = /^path=(.+)$/m.exec(ini)?.[1]?.trim() ?? join(home, `${name}.avd`);
      const config = readFileSync(join(folder, "config.ini"), "utf8");
      const sysdir = /^image\.sysdir\.1=(.+)$/m.exec(config)?.[1];
      if (sysdir) return imageFromSysdir(sysdir);
    } catch {
      // not in this folder
    }
  }
  return null;
}
