import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { IS_WIN, runFile } from "./shell.ts";

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(0);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** An error that retrying will not fix (a wrong url, no permission). */
class FatalDownloadError extends Error {}

export interface DownloadOptions {
  retries?: number;
  /** Replaced in tests, so they do not really wait */
  wait?: (ms: number) => Promise<void>;
}

/**
 * Download a file. A broken connection does not start over: the part that is already there is kept in `<dest>.part`
 * and the next try asks the server for the rest. The file only gets its real name when it is complete.
 */
export async function download(url: string, dest: string, label: string, { retries = 4, wait = sleep }: DownloadOptions = {}): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const part = `${dest}.part`;

  for (let attempt = 0; ; attempt++) {
    try {
      await fetchInto(url, part, label);
      break;
    } catch (error) {
      if (error instanceof FatalDownloadError || attempt >= retries) throw error;
      const reason = (error as { cause?: { code?: string } }).cause?.code ?? (error as Error).message;
      clearLine();
      console.log(`     ${label}: the connection was lost (${reason}), trying again and continuing where it stopped...`);
      await wait(2000 * (attempt + 1));
    }
  }
  await rename(part, dest);
  clearLine();
}

const clearLine = () => process.stdout.isTTY && process.stdout.write(`\r${" ".repeat(70)}\r`);

async function fetchInto(url: string, part: string, label: string): Promise<void> {
  const existing = await stat(part).then((s) => s.size, () => 0);
  const res = await fetch(url, { redirect: "follow", headers: existing > 0 ? { range: `bytes=${existing}-` } : {} });

  if (res.status === 416) {
    // We asked for a part the server does not have: what we have is not usable, start again
    await rm(part, { force: true });
    throw new Error("the partial download could not be continued");
  }
  if (!res.ok || !res.body) {
    const message = `Download failed (HTTP ${res.status}): ${url}`;
    throw res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429 ? new FatalDownloadError(message) : new Error(message);
  }

  // 206 = the server continues where we stopped, 200 = it sends everything again
  const resumed = res.status === 206 && existing > 0;
  const offset = resumed ? existing : 0;
  const length = Number(res.headers.get("content-length")) || 0;
  const total = length ? offset + length : 0;
  const body = Readable.fromWeb(res.body as WebReadableStream);
  let received = offset;
  let lastPercent = -1;

  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (!total || !process.stdout.isTTY) return;
    const percent = Math.floor((received / total) * 100);
    if (percent === lastPercent) return;
    lastPercent = percent;
    process.stdout.write(`\r     ${label} ${percent}% (${mb(received)} / ${mb(total)} MB)   `);
  });

  await pipeline(body, createWriteStream(part, { flags: resumed ? "a" : "w" }));
  if (total && received !== total) throw new Error(`only ${mb(received)} of ${mb(total)} MB arrived`);
}

/**
 * Unpack a .zip or .tar.gz with what the system already has, so we do not need a dependency for it.
 * tar (bsdtar on macOS and Windows 10+) reads both. Where it cannot read a .zip (GNU tar on Linux, or another
 * tar first in the PATH on Windows) we fall back to unzip, or to PowerShell on Windows.
 */
export async function extractArchive(file: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const tar = runFile("tar", ["-xf", file, "-C", destDir]);
  if (tar.exitCode === 0) return;

  if (file.endsWith(".zip")) {
    const fallback = IS_WIN
      ? runFile("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${file.replaceAll("'", "''")}' -DestinationPath '${destDir.replaceAll("'", "''")}' -Force`])
      : runFile("unzip", ["-q", "-o", file, "-d", destDir]);
    if (fallback.exitCode === 0) return;
    throw new Error(`Could not extract ${file}: ${fallback.output || tar.output}`);
  }
  throw new Error(`Could not extract ${file}: ${tar.output}`);
}
