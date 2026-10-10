import { spawnSync } from "node:child_process";

/**
 * Behind a company proxy (HTTPS_PROXY / HTTP_PROXY in the environment) the downloads need to go through
 * that proxy too. Node.js can do that for fetch, but only when it is started with NODE_USE_ENV_PROXY=1.
 */

export const proxyUrl = (env: NodeJS.ProcessEnv = process.env): string | null =>
  env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || null;

export interface RelaunchOptions {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  execPath?: string;
}

/**
 * Start this same script again with the proxy support switched on. Returns the exit code of that run,
 * or null when it is not needed (no proxy, or already switched on) and the script can just go on.
 */
export function relaunchWithProxy({ env = process.env, argv = process.argv, execPath = process.execPath }: RelaunchOptions = {}): number | null {
  if (!proxyUrl(env) || env.NODE_USE_ENV_PROXY) return null;
  const { status } = spawnSync(execPath, argv.slice(1), { stdio: "inherit", env: { ...env, NODE_USE_ENV_PROXY: "1" } });
  return status ?? 1;
}

/** The Android SDK manager is a Java program, it does not read the proxy variables: it needs them as options. */
export function sdkManagerProxyArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const value = proxyUrl(env);
  if (!value) return [];
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return [`--proxy=${url.protocol === "socks5:" ? "socks" : "http"}`, `--proxy_host=${url.hostname}`, `--proxy_port=${port}`];
  } catch {
    return [];
  }
}
