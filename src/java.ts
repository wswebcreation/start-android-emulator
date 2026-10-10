import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { arch, homedir } from "node:os";
import { join } from "node:path";
import { download, extractArchive } from "./download.ts";
import { IS_MAC, IS_WIN, runFile } from "./shell.ts";

export const MIN_JAVA = 17;
export const JDK_FEATURE_VERSION = 21;

export interface JavaInstall {
  home: string;
  major: number;
  source: "JAVA_HOME" | "downloaded by setup";
}

/** ~/.jdks is the folder IntelliJ, Android Studio and Gradle use for downloaded JDKs, so they find ours too. */
export const jdkDir = () => join(homedir(), ".jdks", `temurin-${JDK_FEATURE_VERSION}`);

export const exe = (name: string, win = ".exe") => (IS_WIN ? `${name}${win}` : name);

export function isValidJavaHome(dir: string | null | undefined): dir is string {
  return Boolean(dir) && existsSync(join(dir!, "bin", exe("java")));
}

/** Major Java version of a JAVA_HOME, e.g. 21. Handles the old "1.8.0" scheme. */
export function javaMajor(home: string | null | undefined): number | null {
  if (!isValidJavaHome(home)) return null;
  const { output } = runFile(join(home, "bin", exe("java")), ["-version"]);
  const match = output.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return match[1] === "1" ? Number(match[2]) : Number(match[1]);
}

function jdkHomeIn(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const top = readdirSync(dir).find((name) => name.startsWith("jdk"));
  if (!top) return null;
  const home = IS_MAC ? join(dir, top, "Contents", "Home") : join(dir, top);
  return isValidJavaHome(home) ? home : null;
}

/** Find a usable Java (17+): the one in JAVA_HOME, or the one we downloaded earlier. */
export function detectJava(): JavaInstall | null {
  const candidates = [
    { home: process.env.JAVA_HOME, source: "JAVA_HOME" },
    { home: jdkHomeIn(jdkDir()), source: "downloaded by setup" },
  ] as const;
  for (const { home, source } of candidates) {
    const major = javaMajor(home);
    if (home && major && major >= MIN_JAVA) return { home, major, source };
  }
  return null;
}

/** Download Temurin (Eclipse Adoptium) into ~/.jdks/temurin-21. Leaves the system Java and other JDKs untouched. */
export async function installJdk(): Promise<string> {
  const os = IS_MAC ? "mac" : IS_WIN ? "windows" : "linux";
  const cpu = arch() === "arm64" ? "aarch64" : "x64";
  const url = `https://api.adoptium.net/v3/binary/latest/${JDK_FEATURE_VERSION}/ga/${os}/${cpu}/jdk/hotspot/normal/eclipse`;
  const dir = jdkDir();
  const archive = `${dir}${IS_WIN ? ".zip" : ".tar.gz"}`;

  await rm(dir, { recursive: true, force: true });
  await download(url, archive, `Downloading Java ${JDK_FEATURE_VERSION}`);
  await extractArchive(archive, dir);
  await rm(archive, { force: true });

  const home = jdkHomeIn(dir);
  if (!home) throw new Error(`Java was downloaded but no JDK was found in ${dir}`);
  return home;
}
