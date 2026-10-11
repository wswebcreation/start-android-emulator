import { avdName, DEFAULT_DEVICE, type DeviceProfile } from "./android/avd.ts";
import { type AndroidVersion } from "./android/versions.ts";
import { NAME } from "./args.ts";

/** The devices to pick from. The skin is the device frame, a newer phone can use the profile of an older one. */
export const DEVICE_PRESETS: { label: string; device: DeviceProfile }[] = [
  { label: "Pixel 10", device: { profile: "pixel_9", skin: "pixel_10" } },
  { label: "Pixel 9", device: { profile: "pixel_9", skin: "pixel_9" } },
  { label: "Pixel 9 Pro", device: { profile: "pixel_9_pro", skin: "pixel_9_pro" } },
  { label: "Pixel 8", device: { profile: "pixel_8", skin: "pixel_8" } },
  { label: "Pixel 8 Pro", device: { profile: "pixel_8_pro", skin: "pixel_8_pro" } },
  { label: "Pixel Tablet", device: { profile: "pixel_tablet", skin: "pixel_tablet" } },
  { label: "Pixel Fold", device: { profile: "pixel_fold", skin: "pixel_fold" } },
];

/** What the wizard asks with, so a test can answer for the user. */
export interface Asker {
  select: (options: unknown) => Promise<string>;
  input: (options: unknown) => Promise<string>;
  confirm: (options: unknown) => Promise<boolean>;
}

export interface Given {
  api?: string;
  device?: string;
  skin?: string;
}

export interface NewEmulator {
  name: string;
  device: DeviceProfile;
}

const CUSTOM = "__custom__";
const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * Ask for the Android version once, then the device and the name of as many emulators as the user wants.
 * What was given on the command line is not asked again.
 */
export async function askNewEmulators(versions: AndroidVersion[], given: Given, ask: Asker): Promise<{ version: AndroidVersion; emulators: NewEmulator[] }> {
  const newest = versions[0]!;
  const choices = versions.filter((v) => Number.parseFloat(v.api) >= 30);

  const api = given.api ?? (await ask.select({ message: "Which Android version?", choices: choices.map((v) => ({ value: v.api, name: v.label })), default: newest.api }));
  const version = versions.find((v) => v.api === api || Number.parseFloat(v.api) === Number.parseFloat(api)) ?? newest;

  const emulators: NewEmulator[] = [];
  do {
    const device = given.device ? { profile: given.device, skin: given.skin ?? given.device } : await askDevice(given.skin, ask);
    emulators.push({ name: await askName(avdName(version, device), emulators.map((e) => e.name), ask), device });
  } while (await ask.confirm({ message: `Create another emulator? (${emulators.length} so far)`, default: false }));

  return { version, emulators };
}

async function askName(suggestion: string, taken: string[], ask: Asker): Promise<string> {
  const validName = (value: string) => (!NAME.test(value) || value.includes("{") ? "Use letters, numbers, _ . - and no spaces" : taken.includes(value) ? `You already named an emulator ${value}` : true);
  const picked = taken.includes(suggestion)
    ? CUSTOM
    : await ask.select({
        message: "What should the emulator be called?",
        choices: [{ value: suggestion, name: `${suggestion} (suggested)` }, { value: CUSTOM, name: "Type my own name" }],
        default: suggestion,
      });
  return picked === CUSTOM ? ask.input({ message: "Name of the emulator (use letters, numbers, _ . -)", validate: validName }) : picked;
}

async function askDevice(skin: string | undefined, ask: Asker): Promise<DeviceProfile> {
  const value = await ask.select({
    message: "Which device?",
    choices: [...DEVICE_PRESETS.map((p, i) => ({ value: String(i), name: p.label })), { value: CUSTOM, name: "Other hardware profile (avdmanager list device)" }],
    default: "1",
  });
  if (value !== CUSTOM) {
    const preset = DEVICE_PRESETS[Number(value)]!.device;
    return skin ? { ...preset, skin } : preset;
  }
  const profile = (await ask.input({ message: "Hardware profile (like pixel_7 or medium_tablet)", default: DEFAULT_DEVICE.profile, validate: (v: string) => (/^[\w-]+$/.test(v) ? true : "Use letters, numbers, _ and -") })).trim();
  return { profile, skin: skin ?? profile };
}
