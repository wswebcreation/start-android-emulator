import { type JavaInstall, detectJava } from "../java.ts";
import { listAvds, listEmulators } from "./avd.ts";
import { type EnvGaps, androidEnvGaps, defaultSdkPath, detectSdkPath, emulatorBinary, listInstalledPackages, sdkTool } from "./sdk.ts";

/** What this machine has today. Only looks, nothing is changed. */
export interface Inspection {
  /** Where the SDK is, or where we would put it */
  sdk: string;
  sdkFound: boolean;
  java: JavaInstall | null;
  /** The command-line tools (sdkmanager) are installed */
  toolsReady: boolean;
  /** Null when we cannot tell, because there is no Java or no command-line tools */
  installedPackages: Set<string> | null;
  /** The emulator program is installed, so emulators can be started */
  emulatorReady: boolean;
  /** The names of the emulators that exist */
  avds: string[];
  env: EnvGaps;
}

export function inspect(): Inspection {
  const found = detectSdkPath();
  const sdk = found ?? defaultSdkPath();
  const java = detectJava();
  const toolsReady = Boolean(sdkTool(sdk, "sdkmanager"));
  const canAsk = java !== null && toolsReady;

  return {
    sdk,
    sdkFound: found !== null,
    java,
    toolsReady,
    installedPackages: canAsk ? listInstalledPackages(sdk, java.home) : null,
    emulatorReady: Boolean(emulatorBinary(sdk)),
    avds: listEmulators(sdk) ?? (canAsk ? listAvds(sdk, java.home) : null) ?? [],
    env: androidEnvGaps(),
  };
}
