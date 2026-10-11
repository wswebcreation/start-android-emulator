import type { PackageUpdate } from "./sdk.ts";

export interface Removable {
  id: string;
  kind: "image" | "platform" | "sources";
}

const apiOf = (id: string) => /;android-([\d.]+)/.exec(id)?.[1];

/**
 * The emulator-related packages no emulator needs: system images that no emulator uses, and the platforms and sources
 * of Android versions without an emulator. Build tools, NDK and the like are not ours to judge.
 */
export function unusedPackages(installed: Iterable<string>, usedImages: string[]): Removable[] {
  const usedApis = new Set(usedImages.map(apiOf));
  const unused: Removable[] = [];
  for (const id of installed) {
    if (id.startsWith("system-images;") && !usedImages.includes(id)) unused.push({ id, kind: "image" });
    else if (/^platforms;android-[\d.]+$/.test(id) && !usedApis.has(apiOf(id))) unused.push({ id, kind: "platform" });
    else if (/^sources;android-[\d.]+$/.test(id) && !usedApis.has(apiOf(id))) unused.push({ id, kind: "sources" });
  }
  return unused.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** Updates worth installing: everything except new versions of system images that no emulator uses, those would only be a big download. */
export function splitUpdates(updates: PackageUpdate[], usedImages: string[]): { apply: PackageUpdate[]; skipped: PackageUpdate[] } {
  const skipped = updates.filter((u) => u.id.startsWith("system-images;") && !usedImages.includes(u.id));
  return { apply: updates.filter((u) => !skipped.includes(u)), skipped };
}
