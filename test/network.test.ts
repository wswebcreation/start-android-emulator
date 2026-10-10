import assert from "node:assert/strict";
import { mock, test } from "node:test";

type SpawnArgs = [string, string[], { env: NodeJS.ProcessEnv; stdio: string }];

const spawnSync = mock.fn((..._args: unknown[]) => ({ status: 0 as number | null }));
mock.module("node:child_process", { namedExports: { spawnSync } });
const { proxyUrl, relaunchWithProxy, sdkManagerProxyArgs } = await import("../src/network.ts");

test("the proxy is read from the usual variables, upper or lower case", () => {
  assert.equal(proxyUrl({}), null);
  assert.equal(proxyUrl({ HTTPS_PROXY: "http://a:1" }), "http://a:1");
  assert.equal(proxyUrl({ https_proxy: "http://b:2" }), "http://b:2");
  assert.equal(proxyUrl({ HTTP_PROXY: "http://c:3" }), "http://c:3");
  assert.equal(proxyUrl({ http_proxy: "http://d:4" }), "http://d:4");
});

test("without a proxy the script just goes on", () => {
  spawnSync.mock.resetCalls();
  assert.equal(relaunchWithProxy({ env: {} }), null);
  assert.equal(spawnSync.mock.callCount(), 0);
});

test("with a proxy the script runs again with proxy support, and returns the exit code of that run", () => {
  spawnSync.mock.resetCalls();
  spawnSync.mock.mockImplementationOnce(() => ({ status: 3 }));
  const env = { HTTPS_PROXY: "http://proxy:8080" };
  assert.equal(relaunchWithProxy({ env, argv: ["node", "/pkg/dist/cli.js", "--yes"], execPath: "/usr/bin/node" }), 3);
  const [file, args, options] = spawnSync.mock.calls[0]!.arguments as SpawnArgs;
  assert.equal(file, "/usr/bin/node");
  assert.deepEqual(args, ["/pkg/dist/cli.js", "--yes"]);
  assert.equal(options.env.NODE_USE_ENV_PROXY, "1");
  assert.equal(options.stdio, "inherit");
});

test("a run that was stopped by a signal counts as a failure", () => {
  spawnSync.mock.mockImplementationOnce(() => ({ status: null }));
  assert.equal(relaunchWithProxy({ env: { HTTP_PROXY: "http://p:1" } }), 1);
});

test("the script is not started a second time when proxy support is already on", () => {
  spawnSync.mock.resetCalls();
  assert.equal(relaunchWithProxy({ env: { HTTPS_PROXY: "http://p:1", NODE_USE_ENV_PROXY: "1" } }), null);
  assert.equal(spawnSync.mock.callCount(), 0);
});

test("the SDK manager gets the proxy as options", () => {
  assert.deepEqual(sdkManagerProxyArgs({}), []);
  assert.deepEqual(sdkManagerProxyArgs({ HTTPS_PROXY: "http://proxy.company.com:8080" }), ["--proxy=http", "--proxy_host=proxy.company.com", "--proxy_port=8080"]);
  assert.deepEqual(sdkManagerProxyArgs({ HTTPS_PROXY: "proxy.company.com:3128" }), ["--proxy=http", "--proxy_host=proxy.company.com", "--proxy_port=3128"]);
  assert.deepEqual(sdkManagerProxyArgs({ HTTP_PROXY: "http://proxy" }), ["--proxy=http", "--proxy_host=proxy", "--proxy_port=80"]);
  assert.deepEqual(sdkManagerProxyArgs({ HTTPS_PROXY: "https://secure" }), ["--proxy=http", "--proxy_host=secure", "--proxy_port=443"]);
  assert.deepEqual(sdkManagerProxyArgs({ HTTPS_PROXY: "socks5://socks:1080" }), ["--proxy=socks", "--proxy_host=socks", "--proxy_port=1080"]);
});

test("a proxy value that is not a url adds no options", () => {
  assert.deepEqual(sdkManagerProxyArgs({ HTTPS_PROXY: "http://" }), []);
});
