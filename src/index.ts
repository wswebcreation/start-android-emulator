/** The public API, for projects that want to set up the Android environment from their own code. */
export { main } from "./flow.ts";
export { inspect, type Inspection } from "./android/inspect.ts";
export { listEmulators } from "./android/avd.ts";
export { defaultTarget, namedTarget, setupAndroid, type SetupTarget } from "./android/setup.ts";
export { fetchVersions, resolveVersion, type AndroidVersion } from "./android/versions.ts";
