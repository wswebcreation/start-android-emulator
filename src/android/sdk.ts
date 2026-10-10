import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { download, extractArchive } from "../download.ts";
import { MIN_JAVA, exe, isValidJavaHome, javaMajor } from "../java.ts";
import { sdkManagerProxyArgs } from "../network.ts";
import { IS_MAC, IS_WIN, run, runFile } from "../shell.ts";

const OS_NAME = IS_MAC ? "mac" : IS_WIN ? "win" : "linux";

export function defaultSdkPath(): string {
  const home = homedir();
  return IS_MAC
    ? join(home, "Library", "Android", "sdk")
    : IS_WIN
      ? join(process.env.LOCALAPPDATA || home, "Android", "Sdk")
      : join(home, "Android", "Sdk");
}

/** An existing SDK: ANDROID_HOME, or the default location for this OS. */
export function detectSdkPath(): string | null {
  const configured = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (configured && existsSync(configured)) return configured;
  const candidates = [defaultSdkPath(), join(homedir(), "android", "sdk")];
  return candidates.find((p) => existsSync(join(p, "platform-tools")) || existsSync(join(p, "cmdline-tools"))) ?? null;
}

/** Google publishes a new build number per OS, so read the latest from the repository listing. */
async function latestCmdlineToolsUrl(): Promise<string> {
  const base = "https://dl.google.com/android/repository";
  const res = await fetch(`${base}/repository2-3.xml`);
  if (!res.ok) throw new Error(`Could not read the Android repository listing (HTTP ${res.status})`);
  const xml = await res.text();
  const builds = [...xml.matchAll(new RegExp(`commandlinetools-${OS_NAME}-(\\d+)_latest\\.zip`, "g"))].map((m) => Number(m[1]));
  if (builds.length === 0) throw new Error(`No command-line tools found for ${OS_NAME}`);
  return `${base}/commandlinetools-${OS_NAME}-${Math.max(...builds)}_latest.zip`;
}

/** Download the Android command-line tools into <sdk>/cmdline-tools/latest. */
export async function installCmdlineTools(sdk: string): Promise<void> {
  const url = await latestCmdlineToolsUrl();
  const tmp = join(sdk, ".cmdline-tools-download");
  const zip = join(tmp, "tools.zip");

  await rm(tmp, { recursive: true, force: true });
  await download(url, zip, "Downloading Android command-line tools");
  await extractArchive(zip, join(tmp, "out"));

  await mkdir(join(sdk, "cmdline-tools"), { recursive: true });
  await rm(join(sdk, "cmdline-tools", "latest"), { recursive: true, force: true });
  await rename(join(tmp, "out", "cmdline-tools"), join(sdk, "cmdline-tools", "latest"));
  await rm(tmp, { recursive: true, force: true });
}

export function sdkTool(sdk: string, name: string): string | null {
  const file = join(sdk, "cmdline-tools", "latest", "bin", exe(name, ".bat"));
  return existsSync(file) ? file : null;
}

/** The emulator program, or null when the emulator package is not installed. */
export function emulatorBinary(sdk: string): string | null {
  const file = join(sdk, "emulator", exe("emulator"));
  return existsSync(file) ? file : null;
}

export function platformToolsDirs(sdk: string): string[] {
  return [join(sdk, "platform-tools"), join(sdk, "emulator")];
}

/** The SDK tools need Java 17+, so pass the JDK we picked instead of whatever JAVA_HOME points to. */
export function toolEnv(sdk: string, jdk: string): NodeJS.ProcessEnv {
  return { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk };
}

/** The package ids that are installed (like "emulator"), or null when sdkmanager is missing or fails. */
export function listInstalledPackages(sdk: string, jdk: string): Set<string> | null {
  const sdkmanager = sdkTool(sdk, "sdkmanager");
  if (!sdkmanager) return null;
  const { output, exitCode } = runFile(sdkmanager, [`--sdk_root=${sdk}`, "--list_installed"], { env: toolEnv(sdk, jdk) });
  if (exitCode !== 0) return null;
  const installed = new Set<string>();
  for (const line of output.split("\n")) {
    const id = line.split("|")[0]?.trim();
    if (id && /^[a-z][\w.-]*(;[\w.-]+)*$/i.test(id) && id !== "Path") installed.add(id);
  }
  return installed;
}

export function acceptLicenses(sdk: string, jdk: string): boolean {
  const sdkmanager = sdkTool(sdk, "sdkmanager");
  if (!sdkmanager) return false;
  return runFile(sdkmanager, [`--sdk_root=${sdk}`, ...sdkManagerProxyArgs(), "--licenses"], {
    env: toolEnv(sdk, jdk),
    input: "y\n".repeat(50),
  }).exitCode === 0;
}

export function installPackages(sdk: string, jdk: string, packages: string[]): boolean {
  const sdkmanager = sdkTool(sdk, "sdkmanager");
  if (!sdkmanager) return false;
  return runFile(sdkmanager, [`--sdk_root=${sdk}`, ...sdkManagerProxyArgs(), "--install", ...packages], {
    env: toolEnv(sdk, jdk),
    inherit: true,
  }).exitCode === 0;
}

export interface EnvGaps {
  vars: ("ANDROID_HOME" | "JAVA_HOME")[];
  pathMissing: boolean;
}

/** What this terminal is missing: ANDROID_HOME, a usable JAVA_HOME (17+) and adb on the PATH. Shared by the setup and the check. */
export function androidEnvGaps(): EnvGaps {
  const vars: EnvGaps["vars"] = [];
  const androidHome = process.env.ANDROID_HOME;
  if (!androidHome || !existsSync(androidHome)) vars.push("ANDROID_HOME");
  const javaHome = process.env.JAVA_HOME;
  if (!isValidJavaHome(javaHome) || (javaMajor(javaHome) ?? 0) < MIN_JAVA) vars.push("JAVA_HOME");
  return { vars, pathMissing: !run("adb --version") };
}
