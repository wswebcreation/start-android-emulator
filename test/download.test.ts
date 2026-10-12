import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, mock, test } from "node:test";
import { download, extractArchive } from "../src/download.ts";

const skipOnWindows = { skip: process.platform === "win32" && "uses tar from the shell" };
const payload = Buffer.alloc(3 * 1024 * 1024, "a");
let server: Server;
let base: string;
let dir: string;
const hits: Record<"flaky" | "ignores" | "unsat" | "short", string[]> = { flaky: [], ignores: [], unsat: [], short: [] };
const seenEncodings: (string | undefined)[] = [];
const noWait = { wait: async () => {} };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'workshop-download-'))
  server = createServer((req, res) => {
    const range = req.headers.range?.match(/bytes=(\d+)-/)
    if (req.url === '/missing') {
      res.writeHead(404).end()
    } else if (req.url === '/busy') {
      res.writeHead(503).end()
    } else if (req.url === '/flaky') {
      // The first request breaks half way, the next ones continue where it stopped
      hits.flaky.push(req.headers.range ?? 'none')
      if (!range) {
        res.writeHead(200, { 'content-length': payload.length })
        res.write(payload.subarray(0, 1024 * 1024))
        setTimeout(() => res.destroy(), 20)
      } else {
        const from = Number(range[1])
        res.writeHead(206, { 'content-length': payload.length - from }).end(payload.subarray(from))
      }
    } else if (req.url === '/ignores-range') {
      hits.ignores.push(req.headers.range ?? 'none')
      if (hits.ignores.length === 1) {
        res.writeHead(200, { 'content-length': payload.length })
        res.write(payload.subarray(0, 1024 * 1024))
        setTimeout(() => res.destroy(), 20)
      } else {
        res.writeHead(200, { 'content-length': payload.length }).end(payload)
      }
    } else if (req.url === '/range-not-satisfiable') {
      hits.unsat.push(req.headers.range ?? 'none')
      if (range) res.writeHead(416).end()
      else res.writeHead(200, { 'content-length': payload.length }).end(payload)
    } else if (req.url === '/gzip') {
      // Something on the way compressed the body: content-length is the compressed size, smaller than what arrives
      seenEncodings.push(req.headers['accept-encoding'])
      const packed = gzipSync(payload)
      res.writeHead(200, { 'content-length': packed.length, 'content-encoding': 'gzip' }).end(packed)
    } else if (req.url === '/short') {
      // Always too few bytes, but only when nothing is asked to continue
      hits.short.push(req.headers.range ?? 'none')
      if (!range) {
        res.writeHead(200, { 'content-length': payload.length })
        res.end(payload.subarray(0, 1024 * 1024))
      } else {
        const from = Number(range[1])
        res.writeHead(206, { 'content-length': payload.length - from }).end(payload.subarray(from))
      }
    } else if (req.url === '/no-length') {
      res.write('chunked body')
      res.end()
    } else {
      res.writeHead(200, { 'content-length': payload.length }).end(payload)
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => {
  server.close()
  rmSync(dir, { recursive: true, force: true })
})

test('download saves the file and creates missing folders', async () => {
  const dest = join(dir, 'nested', 'folder', 'file.bin')
  await download(`${base}/file`, dest, 'Downloading test')
  assert.equal(readFileSync(dest).length, payload.length)
})

test('download shows progress in a terminal and cleans the line afterwards', async () => {
  const written: string[] = []
  const isTTY = process.stdout.isTTY
  process.stdout.isTTY = true
  mock.method(process.stdout, 'write', (text: string) => written.push(text) && true)
  try {
    await download(`${base}/file`, join(dir, 'progress.bin'), 'Downloading test')
    await download(`${base}/no-length`, join(dir, 'no-length.bin'), 'Downloading test')
  } finally {
    process.stdout.isTTY = isTTY
    mock.restoreAll()
  }
  assert.ok(written.some((text) => /Downloading test \d+% \([\d.]+ \/ 3\.0 MB\)/.test(text)))
  assert.equal(readFileSync(join(dir, 'no-length.bin'), 'utf8'), 'chunked body')
})

test('download fails with the HTTP status and the url', async () => {
  await assert.rejects(download(`${base}/missing`, join(dir, 'x.bin'), 'x'), /HTTP 404.*\/missing/)
})

test('extractArchive unpacks a .tar.gz', skipOnWindows, async () => {
  const src = join(dir, 'src')
  mkdirSync(src)
  writeFileSync(join(src, 'hello.txt'), 'hi')
  const archive = join(dir, 'a.tar.gz')
  execFileSync('tar', ['-czf', archive, '-C', src, '.'])

  await extractArchive(archive, join(dir, 'tar-out'))
  assert.equal(readFileSync(join(dir, 'tar-out', 'hello.txt'), 'utf8'), 'hi')
})

test('extractArchive explains when an archive is broken', skipOnWindows, async () => {
  const broken = join(dir, 'broken.tar.gz')
  writeFileSync(broken, 'not an archive')
  await assert.rejects(extractArchive(broken, join(dir, 'broken-out')), /Could not extract/)
  assert.ok(existsSync(join(dir, 'broken-out')))
})

test('download continues where a broken connection stopped, and does not leave a part file behind', async () => {
  const dest = join(dir, 'flaky.bin')
  const messages: string[] = []
  mock.method(console, 'log', (line: string) => messages.push(line))
  try {
    await download(`${base}/flaky`, dest, 'Downloading flaky', noWait)
  } finally {
    mock.restoreAll()
  }
  assert.deepEqual(readFileSync(dest), payload)
  assert.equal(hits.flaky[0], 'none')
  assert.match(hits.flaky[1]!, /^bytes=\d+-$/)
  assert.ok(Number(hits.flaky[1]!.match(/\d+/)![0]) > 0)
  assert.ok(messages.some((line) => /connection was lost.*continuing where it stopped/.test(line)))
  assert.equal(existsSync(`${dest}.part`), false)
})

test('download starts over when the server ignores the request to continue', async () => {
  const dest = join(dir, 'ignores.bin')
  await download(`${base}/ignores-range`, dest, 'x', noWait)
  assert.deepEqual(readFileSync(dest), payload)
  assert.match(hits.ignores[1]!, /^bytes=/)
})

test('download starts over when the server cannot continue the part it has', async () => {
  const dest = join(dir, 'unsat.bin')
  writeFileSync(`${dest}.part`, 'old part')
  const messages: string[] = []
  mock.method(console, 'log', (line: string) => messages.push(line))
  try {
    await download(`${base}/range-not-satisfiable`, dest, 'x', noWait)
  } finally {
    mock.restoreAll()
  }
  assert.deepEqual(readFileSync(dest), payload)
  assert.deepEqual(hits.unsat, ['bytes=8-', 'none'])
})

test('download asks for an uncompressed body and accepts a body that is encoded on the way', async () => {
  const dest = join(dir, 'gzip.bin')
  await download(`${base}/gzip`, dest, 'x', noWait)
  assert.deepEqual(readFileSync(dest), payload)
  assert.deepEqual(seenEncodings, ['identity'])
})

test('download retries and continues when too few bytes arrive', async () => {
  const dest = join(dir, 'short.bin')
  mock.method(console, 'log', () => {})
  try {
    await download(`${base}/short`, dest, 'x', noWait)
  } finally {
    mock.restoreAll()
  }
  assert.deepEqual(readFileSync(dest), payload)
  assert.deepEqual(hits.short, ['none', `bytes=${1024 * 1024}-`])
})

test('download gives up after the retries on a server error, but does not retry a wrong url', async () => {
  let waits = 0
  const wait = async () => {
    waits++
  }
  await assert.rejects(download(`${base}/busy`, join(dir, 'busy.bin'), 'x', { retries: 2, wait }), /HTTP 503/)
  assert.equal(waits, 2)
  waits = 0
  await assert.rejects(download(`${base}/missing`, join(dir, 'missing.bin'), 'x', { retries: 2, wait }), /HTTP 404/)
  assert.equal(waits, 0)
})

test('download waits a little longer after every failed try', async () => {
  const waited: number[] = []
  await assert.rejects(download(`${base}/busy`, join(dir, 'busy2.bin'), 'x', { retries: 2, wait: async (ms: number) => {
        waited.push(ms)
      } }))
  assert.deepEqual(waited, [2000, 4000])
})

test('download really waits between tries by default', async () => {
  const realSetTimeout = globalThis.setTimeout
  const delays: number[] = []
  globalThis.setTimeout = ((fn: () => void, ms: number, ...rest: unknown[]) => {
    if (ms === 2000) delays.push(ms)
    return realSetTimeout(fn, ms === 2000 ? 0 : ms, ...rest)
  }) as typeof setTimeout
  try {
    await assert.rejects(download(`${base}/busy`, join(dir, 'busy3.bin'), 'x', { retries: 1 }))
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
  assert.deepEqual(delays, [2000])
})

test('extractArchive unpacks a .zip', skipOnWindows, async (t) => {
  const src = join(dir, 'zip-src')
  mkdirSync(src)
  writeFileSync(join(src, 'hello.txt'), 'hi zip')
  const archive = join(dir, 'a.zip')
  try {
    execFileSync('zip', ['-qr', archive, '.'], { cwd: src })
  } catch {
    try {
      execFileSync('tar', ['-a', '-cf', archive, '-C', src, '.'])
    } catch {
      return t.skip('no zip or bsdtar available to create a test archive')
    }
  }

  await extractArchive(archive, join(dir, 'zip-out'))
  assert.equal(readFileSync(join(dir, 'zip-out', 'hello.txt'), 'utf8'), 'hi zip')
})
