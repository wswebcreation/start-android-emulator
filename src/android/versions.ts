import { arch } from "node:os";

export type Abi = "arm64-v8a" | "x86_64";

export interface AndroidVersion {
  /** The API level as the SDK names it, like "37.0" or "36" */
  api: string;
  /** Human readable, like "Android 17 (API 37.0)" */
  label: string;
}

export const abi = (): Abi => (arch() === "arm64" ? "arm64-v8a" : "x86_64");

const SYSTEM_IMAGES_URL = "https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml";

// API level (the part before the dot) to the Android release people know it by
const RELEASES: Record<number, string> = { 37: "17", 36: "16", 35: "15", 34: "14", 33: "13", 32: "12L", 31: "12", 30: "11", 29: "10", 28: "9" };

/** Shown when Google's listing cannot be fetched (offline, blocked). The newest first. */
export const FALLBACK_VERSIONS: AndroidVersion[] = ["37.0", "36.1", "36", "35", "34"].map(describe);

function describe(api: string): AndroidVersion {
  const release = RELEASES[Number.parseInt(api, 10)];
  return { api, label: release ? `Android ${release} (API ${api})` : `API ${api}` };
}

const apiOrder = (a: string, b: string) => Number.parseFloat(b) - Number.parseFloat(a);

/**
 * The Android versions we can build an emulator for: stable system images with Google APIs for this CPU, newest first.
 * Beta and canary builds, "-extNN" duplicates and the 16 KB page-size images (the only ones from 37.1 on) are left out.
 */
export function parseVersions(xml: string, cpu: Abi = abi()): AndroidVersion[] {
  const apis = new Set<string>();
  for (const match of xml.matchAll(/<remotePackage path="system-images;android-([\d.]+);google_apis;([\w-]+)">(.*?)<\/remotePackage>/gs)) {
    const [, api = "", imageAbi, body = ""] = match;
    if (imageAbi === cpu && body.includes('<channelRef ref="channel-0"/>')) apis.add(api);
  }
  return [...apis].sort(apiOrder).map(describe);
}

export interface VersionList {
  versions: AndroidVersion[];
  /** "live" when read from Google, "built-in" when the fallback list is used */
  source: "live" | "built-in";
}

export async function fetchVersions(cpu: Abi = abi(), { timeout = 8000 } = {}): Promise<VersionList> {
  try {
    const res = await fetch(SYSTEM_IMAGES_URL, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const versions = parseVersions(await res.text(), cpu);
    if (versions.length === 0) throw new Error("no system images found");
    return { versions, source: "live" };
  } catch {
    return { versions: FALLBACK_VERSIONS, source: "built-in" };
  }
}

/** Match what the user typed (--api 37 or 37.0) with a version we know. Throws with the options when there is none. */
export function resolveVersion(requested: string, versions: AndroidVersion[]): AndroidVersion {
  const wanted = requested.trim();
  const found = versions.find((v) => v.api === wanted) ?? versions.find((v) => v.api === `${wanted}.0`);
  if (found) return found;
  throw new Error(`Android API "${requested}" is not available. Choose one of: ${versions.map((v) => v.api).join(", ")}`);
}

/** The packages sdkmanager needs for an emulator of this version. cmdline-tools is installed separately, it is needed to install the rest. */
export function requiredPackages(version: AndroidVersion, cpu: Abi = abi()): string[] {
  return ["platform-tools", "emulator", `platforms;android-${version.api}`, systemImage(version, cpu)];
}

export const systemImage = (version: AndroidVersion, cpu: Abi = abi()) => `system-images;android-${version.api};google_apis;${cpu}`;
