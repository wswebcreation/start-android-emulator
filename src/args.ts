import { parseArgs } from "node:util";
import { aboutText } from "./about.ts";

export interface Options {
  /** The emulator to start, instead of picking one from a list */
  emulator?: string;
  wipeData: boolean;
  coldBoot: boolean;
  verbose: boolean;
  /** A DNS server to start with, false for --no-dns, undefined when not given (the saved choice or the default is used) */
  dns?: string | false;
  /** Wait until the emulator has booted. --no-wait starts it and returns. */
  wait: boolean;
  /** true for --setup (always show the setup plan), false for --no-setup (never offer it), undefined to offer it when something is missing */
  setup?: boolean;
  /** Only show what is there and what is missing */
  check: boolean;
  /** Answer yes to every question */
  yes: boolean;
  dryRun: boolean;
  /** The Android version, like 37 or 37.0 */
  api?: string;
  /** Emulators to create, by name. {api} in a name becomes the Android version, like 37_0 */
  create: string[];
  /** Emulators to delete, by name */
  delete: string[];
  /** Install the newer versions of the SDK packages that are in use */
  update: boolean;
  /** Remove the SDK packages that no emulator uses */
  prune: boolean;
  /** The hardware profile of avdmanager for the emulators to create, like pixel_9 */
  device?: string;
  /** The device frame for the emulators to create, like pixel_10 (default: the same as the device) */
  skin?: string;
  help: boolean;
  version: boolean;
}

/** A mistake in how the command was used. The message is meant for the user. */
export class UsageError extends Error {}

export const HELP = `${aboutText()}

Usage: start-android-emulator [emulator] [options]

Start options
  --wipe-data        Delete all user data of the emulator before starting
  --cold-boot        Start without using or saving a snapshot
  --dns <ip>         DNS server for the emulator (default: 8.8.8.8, needed when the emulator has no wifi)
  --no-dns           Use the DNS of your computer
  --verbose          Show the output of the emulator while it boots
  --no-wait          Start the emulator and return, without waiting for it to boot

Setup
  --setup            Show the setup plan, also when nothing is missing
  --no-setup         Never offer to install anything, only report what is missing
  --api <level>      Android version to create an emulator for, like 36 or 37.0 (default: the newest)
  --create [name]    Create an emulator with this name, repeat it for more. {api} becomes the version,
                     like --create "Pixel_API_{api}" for Pixel_API_37_0.
                     Without a name you pick the version, the device and the name from a list
  --delete [name]    Delete the emulator with this name, repeat it for more.
                     Without a name you pick the emulators to delete from a list
  --update           Install the newer versions of the SDK packages in use, like the emulator and the system
                     images of your emulators (the emulators themselves keep their data)
  --prune            Remove the system images, platforms and sources no emulator uses, all selected
  --device <profile> Hardware profile for the emulators to create (default: pixel_9)
  --skin <skin>      Device frame for the emulators to create (default: the same as the device)
  --dry-run          Show what the setup would do, without changing anything

Other
  --check            Only show what is set up and what is missing, exits with 1 when something is missing
  -y, --yes          Answer yes to every question (also needed to set up without a terminal)
  -h, --help         Show this help
  -v, --version      Show the version

Examples
  Create an emulator by picking the version, device and name from a list:
    start-android-emulator --create
  Create an emulator with the newest Android version, then start it:
    start-android-emulator --create "Pixel_API_{api}"
    start-android-emulator Pixel_API_37_0
  Create two emulators for Android 36 with another device and frame, without questions:
    start-android-emulator --create "Test_1_API_{api}" --create "Test_2_API_{api}" --api 36 --device pixel_9 --skin pixel_10 --yes
  See what would happen without changing anything:
    start-android-emulator --create "Pixel_API_{api}" --dry-run
  Keep the SDK up to date, and remove what no emulator needs:
    start-android-emulator --update
    start-android-emulator --prune
  Delete emulators by picking them from a list:
    start-android-emulator --delete
  Delete emulators (asks first, --yes skips the question):
    start-android-emulator --delete Test_1_API_37_0 --delete Test_2_API_37_0
`;

const IP = /^[0-9a-f.:]+$/i;
export const NAME = /^[\w.{}-]+$/;

export function parseOptions(argv: string[]): Options {
  // parseArgs can negate a boolean (--no-wait) but not a string option, so --no-dns is taken out first
  const noDns = argv.includes("--no-dns");
  // A --create or --delete without a name (last, or before another option) starts the questions, parseArgs wants a value for it
  const rest = argv.filter((arg) => arg !== "--no-dns").map((arg, i, all) => ((arg === "--create" || arg === "--delete") && (all[i + 1] === undefined || all[i + 1]!.startsWith("-")) ? `${arg}=` : arg));

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      allowNegative: true,
      options: {
        "wipe-data": { type: "boolean" },
        "cold-boot": { type: "boolean" },
        verbose: { type: "boolean" },
        dns: { type: "string" },
        wait: { type: "boolean" },
        setup: { type: "boolean" },
        check: { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        "dry-run": { type: "boolean" },
        api: { type: "string" },
        create: { type: "string", multiple: true },
        delete: { type: "string", multiple: true },
        update: { type: "boolean" },
        prune: { type: "boolean" },
        device: { type: "string" },
        skin: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (e) {
    throw new UsageError(`${(e as Error).message}\n\nRun start-android-emulator --help for the options.`);
  }

  const { values, positionals } = parsed;
  if (positionals.length > 1) throw new UsageError(`Only one emulator can be started at a time, but you gave ${positionals.length}: ${positionals.join(", ")}`);
  if (values.dns !== undefined && noDns) throw new UsageError("Use either --dns <ip> or --no-dns, not both.");
  if (values.dns !== undefined && !IP.test(values.dns)) throw new UsageError(`"${values.dns}" is not an IP address, use for example --dns 8.8.8.8`);
  const create = values.create ?? [];
  if (create.includes("") && create.length > 1) throw new UsageError("Use --create on its own to be asked for the details, or give every --create a name.");
  for (const name of create.filter(Boolean)) {
    if (!NAME.test(name)) throw new UsageError(`"${name}" is not a valid emulator name, use letters, numbers, _ . - and {api}`);
  }
  const del = values.delete ?? [];
  if (del.includes("") && del.length > 1) throw new UsageError("Use --delete on its own to pick the emulators from a list, or give every --delete a name.");
  for (const name of del.filter(Boolean)) {
    if (!NAME.test(name) || name.includes("{")) throw new UsageError(`"${name}" is not a valid emulator name, use letters, numbers, _ . -`);
  }
  if (del.length > 0 && (positionals[0] || create.length > 0)) throw new UsageError("--delete removes emulators, it cannot be combined with --create or an emulator to start.");
  if ((values.update || values.prune) && (positionals[0] || create.length > 0 || del.length > 0)) throw new UsageError("--update and --prune maintain the SDK, they cannot be combined with --create, --delete or an emulator to start.");
  if (positionals[0] && create.length > 0) throw new UsageError("--create sets up emulators, it does not start one. Start them afterwards with their name.");
  if ((values.device || values.skin) && create.length === 0) throw new UsageError("--device and --skin are for the emulators you create, add --create <name>.");

  return {
    emulator: positionals[0],
    wipeData: values["wipe-data"] ?? false,
    coldBoot: values["cold-boot"] ?? false,
    verbose: values.verbose ?? false,
    dns: noDns ? false : values.dns,
    wait: values.wait ?? true,
    setup: values.setup,
    check: values.check ?? false,
    yes: values.yes ?? false,
    dryRun: values["dry-run"] ?? false,
    api: values.api,
    create,
    delete: del,
    update: values.update ?? false,
    prune: values.prune ?? false,
    device: values.device,
    skin: values.skin,
    help: values.help ?? false,
    version: values.version ?? false,
  };
}

/** Any option about how to start: when one is given the user knows what they want, so we do not ask. */
export const hasStartOptions = (o: Options) => o.wipeData || o.coldBoot || o.verbose || o.dns !== undefined;
