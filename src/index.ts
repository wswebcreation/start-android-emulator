/** The public API, for projects that want to set up the Android environment from their own code. */
export { main } from "./flow.ts";
export { inspect, type Inspection } from "./android/inspect.ts";
export { listEmulators } from "./android/avd.ts";
export { defaultTarget, namedTarget, setupAndroid, type SetupTarget } from "./android/setup.ts";
export { fetchVersions, resolveVersion, type AndroidVersion } from "./android/versions.ts";
export { planAndroid, type AvdSpec } from "./android/setup.ts";
export { runPlan, dry, type Step, type PlanResult } from "./plan.ts";
export { configure } from "./configure.ts";
export { persistEnv, applyToProcess } from "./env.ts";
export { relaunchWithProxy } from "./network.ts";
export { launchEmulator, waitForBoot, findRunning } from "./android/emulator.ts";
export { adbBinary } from "./android/sdk.ts";
export type { DeviceProfile } from "./android/avd.ts";
