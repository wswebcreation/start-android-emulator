import { MIN_JAVA, JDK_FEATURE_VERSION, installJdk, javaMajor, type JavaInstall } from "../java.ts";
import { dry, runPlan, type PlanResult, type Step } from "../plan.ts";
import { applyToProcess, persistEnv } from "../env.ts";
import { fail, info, ok, settings, warn } from "../ui.ts";
import { DEFAULT_DEVICE, WORKSHOP_DEVICE, avdName, createAvd, hasSkin, installSkin, workshopAvdNames, type DeviceProfile } from "./avd.ts";
import { type Inspection, inspect } from "./inspect.ts";
import { acceptLicenses, installCmdlineTools, installPackages, platformToolsDirs } from "./sdk.ts";
import { requiredPackages, type AndroidVersion } from "./versions.ts";

export interface AvdSpec {
  name: string;
  device: DeviceProfile;
}

/** What we want to end up with. */
export interface SetupTarget {
  version: AndroidVersion;
  avds: AvdSpec[];
  /** Any emulator that already exists is good enough, ours are only created when there is none */
  anyEmulatorWillDo: boolean;
  /** ANDROID_HOME, JAVA_HOME and PATH must be set (for Appium), not just for starting an emulator */
  requireEnv: boolean;
}

export const defaultTarget = (version: AndroidVersion, name = avdName(version)): SetupTarget => ({
  version,
  avds: [{ name, device: DEFAULT_DEVICE }],
  anyEmulatorWillDo: true,
  requireEnv: false,
});

/** The two Pixel 10 emulators of the Appium + WebdriverIO workshop. */
export const workshopTarget = (version: AndroidVersion): SetupTarget => ({
  version,
  avds: workshopAvdNames(version).map((name) => ({ name, device: WORKSHOP_DEVICE })),
  anyEmulatorWillDo: false,
  requireEnv: true,
});

/** What the steps learn and change while they run: a step needs what the steps before it produced. */
interface Context {
  sdk: string;
  java: JavaInstall | null;
  toolsReady: boolean;
}

/**
 * Describe every step: what it is, whether it is already done, and how to do it. Nothing is changed here.
 * What is `required` stops an emulator from starting. When an emulator can already be started, Java, the command-line
 * tools and the environment are only nice to have: they are for Appium and for setting up more.
 */
export function planAndroid(state: Inspection, target: SetupTarget): Step[] {
  const ctx: Context = { sdk: state.sdk, java: state.java, toolsReady: state.toolsReady };

  const existing = new Set(state.avds);
  const avdsToCreate = target.anyEmulatorWillDo
    ? state.avds.length === 0 ? target.avds : []
    : target.avds.filter((avd) => !existing.has(avd.name));
  const needSdkWork = avdsToCreate.length > 0 || !state.emulatorReady;

  // Without an emulator to create we only need the emulator itself and adb
  const packages = avdsToCreate.length > 0 ? requiredPackages(target.version) : ["platform-tools", "emulator"];
  const missingPackages = packages.filter((p) => !state.installedPackages?.has(p));

  return [
    {
      id: "java",
      title: `Java ${MIN_JAVA}+`,
      description: `Needed by the Android tools and by Appium. If you have no Java, we download Java ${JDK_FEATURE_VERSION} (about 200 MB) and leave your system untouched.`,
      required: needSdkWork,
      done: state.java !== null,
      detail: state.java && `Java ${state.java.major}, ${state.java.home}`,
      apply: () => installJavaStep(ctx),
    },
    {
      id: "tools",
      title: "Android command-line tools",
      description: "The tools that install the rest of the Android SDK and create emulators (about 170 MB).",
      required: needSdkWork,
      done: state.toolsReady,
      detail: state.toolsReady ? state.sdk : null,
      apply: () => installToolsStep(ctx),
    },
    {
      id: "packages",
      title: "Android SDK packages",
      description: `${target.version.label}, the emulator, adb and a system image (about 3 GB).`,
      required: needSdkWork,
      // Packages we cannot ask for (no Java or tools) count as done when an emulator can already be started
      done: missingPackages.length === 0 || (!needSdkWork && state.installedPackages === null),
      detail: "all installed",
      apply: () => installPackagesStep(ctx, missingPackages),
    },
    {
      id: "avds",
      title: target.avds.length === 1 ? "An emulator" : `${target.avds.length} emulators`,
      description: `${target.version.label}. We create ${(avdsToCreate.length ? avdsToCreate : target.avds).map((avd) => avd.name).join(" and ")}.`,
      required: needSdkWork,
      done: avdsToCreate.length === 0,
      detail: target.anyEmulatorWillDo ? `${state.avds.length} found` : target.avds.map((avd) => avd.name).join(", "),
      apply: () => createAvdsStep(ctx, target, avdsToCreate),
    },
    {
      id: "env",
      title: "Environment variables",
      description: "ANDROID_HOME, JAVA_HOME and PATH, so Appium, adb and other tools can find everything. Saved for new terminals.",
      required: target.requireEnv,
      done: state.env.vars.length === 0 && !state.env.pathMissing,
      detail: "ANDROID_HOME, JAVA_HOME and PATH are set",
      apply: () => envStep(ctx, state.env.vars, state.env.pathMissing),
    },
  ];
}

async function installJavaStep(ctx: Context): Promise<boolean> {
  if (settings.dryRun) {
    dry(`would download Java ${JDK_FEATURE_VERSION} to ~/.jdks/temurin-${JDK_FEATURE_VERSION}`);
    ctx.java = { home: "<downloaded java>", major: JDK_FEATURE_VERSION, source: "downloaded by setup" };
    return true;
  }
  try {
    const home = await installJdk();
    ctx.java = { home, major: javaMajor(home) ?? JDK_FEATURE_VERSION, source: "downloaded by setup" };
    ok(`Java ${ctx.java.major}, ${home}`);
    return true;
  } catch (e) {
    fail(`Downloading Java failed: ${(e as Error).message}`);
    info(`You can also install a JDK ${MIN_JAVA}+ yourself from https://adoptium.net and run this setup again.`);
    return false;
  }
}

async function installToolsStep(ctx: Context): Promise<boolean> {
  if (settings.dryRun) {
    dry(`would download the Android command-line tools to ${ctx.sdk}`);
    ctx.toolsReady = true;
    return true;
  }
  try {
    await installCmdlineTools(ctx.sdk);
    ctx.toolsReady = true;
    ok("Android command-line tools installed");
    return true;
  } catch (e) {
    fail(`Downloading the Android command-line tools failed: ${(e as Error).message}`);
    return false;
  }
}

async function installPackagesStep(ctx: Context, missing: string[]): Promise<boolean> {
  if (settings.dryRun) {
    dry(`would accept the licenses and install: ${missing.join(", ")}`);
    return true;
  }
  if (!ctx.java || !ctx.toolsReady) {
    fail("The SDK packages need Java and the command-line tools first. Include those steps and run the setup again.");
    return false;
  }
  if (missing.length === 0 || (acceptLicenses(ctx.sdk, ctx.java.home) && installPackages(ctx.sdk, ctx.java.home, missing))) {
    ok("SDK packages installed");
    return true;
  }
  fail("Installing the SDK packages failed, see the output above");
  return false;
}

async function createAvdsStep(ctx: Context, target: SetupTarget, toCreate: AvdSpec[]): Promise<boolean> {
  const names = toCreate.map((avd) => avd.name).join(", ");
  if (settings.dryRun) {
    dry(`would download the device skin and create ${names}`);
    return true;
  }
  if (!ctx.java || !ctx.toolsReady) {
    fail("Creating emulators needs Java and the command-line tools first. Include those steps and run the setup again.");
    return false;
  }

  for (const skin of new Set(toCreate.map((avd) => avd.device.skin))) {
    if (hasSkin(ctx.sdk, skin)) continue;
    try {
      await installSkin(ctx.sdk, skin);
    } catch (e) {
      warn(`Could not download the emulator skin ${skin} (${(e as Error).message}). The emulator is created without a device frame.`);
    }
  }

  let allCreated = true;
  for (const avd of toCreate) {
    const { output, exitCode } = createAvd(ctx.sdk, ctx.java.home, { name: avd.name, version: target.version, device: avd.device });
    if (exitCode === 0) {
      ok(`Created ${avd.name}`);
    } else {
      fail(`Creating ${avd.name} failed`);
      info(output);
      allCreated = false;
    }
  }
  return allCreated;
}

async function envStep(ctx: Context, vars: string[], pathMissing: boolean): Promise<boolean> {
  const values: Record<string, string> = {};
  if (vars.includes("ANDROID_HOME")) values.ANDROID_HOME = ctx.sdk;
  if (vars.includes("JAVA_HOME") && ctx.java) values.JAVA_HOME = ctx.java.home;
  const paths = pathMissing ? platformToolsDirs(ctx.sdk) : [];

  if (settings.dryRun) {
    dry(`would set ${JSON.stringify(values)} and add ${paths.join(", ") || "nothing"} to PATH`);
    return true;
  }
  try {
    const where = persistEnv({ vars: values, paths });
    applyToProcess({ vars: values, paths });
    ok(`Saved to ${where}`);
    warn("Open a new terminal for this to take effect.");
    return true;
  } catch (e) {
    fail(`Could not save the environment variables: ${(e as Error).message}`);
    return false;
  }
}

/** Look at the machine, show what is missing for the target, and set it up after the user agrees. */
export async function setupAndroid(target: SetupTarget): Promise<PlanResult> {
  info("Checking your machine...");
  return runPlan("This is what we need:", planAndroid(inspect(), target));
}
