/**
 * Local Saber Studio console server (zero runtime dependencies).
 *
 * The page is an untrusted renderer: every effect goes through the same
 * governed path (`saber-core run`), so policy, sandbox confinement and the
 * encrypted audit trail stay identical to the CLI. The server itself only
 * binds 127.0.0.1, never serves the network, and keeps a session-scoped
 * history of run receipts (verbatim verdicts parsed from the core's own
 * output lines — the UI never invents a verdict).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir, platform } from "node:os";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";

import { UI_STRINGS } from "./ui-i18n.js";
import { createUiPage, type StudioBootState } from "./ui-page.js";

/**
 * Split a command line the way a POSIX shell would, except that a
 * backslash stays literal unless it escapes a shell metacharacter
 * (`'`, `"`, `\`, space, tab, newline) — Windows paths must survive
 * verbatim. Single quotes are literal, double quotes allow `\"` and
 * `\\` escapes. This makes `splitArgs` a left-inverse of `joinArgs`,
 * so an approved re-run executes exactly the argv the policy decision
 * was made about.
 */
export function splitArgs(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let index = 0;
  const metaCharacters = "'\"\\ \t\n";
  while (index < input.length) {
    const character = input[index] ?? "";
    if (quote === "'") {
      if (character === "'") {
        quote = null;
      } else {
        current += character;
      }
      index += 1;
      continue;
    }
    if (quote === '"') {
      if (character === "\\" && (input[index + 1] === '"' || input[index + 1] === "\\")) {
        current += input[index + 1];
        index += 2;
        continue;
      }
      if (character === '"') {
        quote = null;
      } else {
        current += character;
      }
      index += 1;
      continue;
    }
    if (character === "\\" && index + 1 < input.length && metaCharacters.includes(input[index + 1] ?? "")) {
      current += input[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      index += 1;
      continue;
    }
    if (character === " " || character === "\t") {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      index += 1;
      continue;
    }
    current += character;
    index += 1;
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}

/**
 * Re-quote argv into one command line. `argv.join(" ")` is not enough:
 * `sh -c 'echo a b'` must not round-trip into `sh -c echo a b`, or the
 * approval flow would re-run a different command than the one denied.
 */
export function joinArgs(argv: string[]): string {
  return argv
    .map((part) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(part) ? part : `'${part.replaceAll("'", "'\\''")}'`))
    .join(" ");
}

/** One parsed run receipt; every field comes from the core's verdict line. */
export interface RunReceipt {
  at: string;
  runId: string | null;
  verdict: "executed" | "denied" | "unparsed";
  denyReason: string | null;
  exitCode: number | null;
  events: number | null;
  hashChainVerified: boolean;
  durationMs: number;
  argv: string[];
  command: string;
  allowed: string[];
  approved: boolean;
  stdout: string;
  store: string | null;
}

const VERDICT_LINE =
  /^run (run_\d+) (denied|executed)(?: \(([^)]+)\))?(?: exit=(-?\d+))?: events=(\d+) hash_chain_verified=(true|false)/;
const STORE_LINE = /^store (.+)$/;

/** Parse the core's first stdout lines into receipt fields. */
export function parseRunReceipt(stdout: string): {
  runId: string | null;
  verdict: "executed" | "denied" | "unparsed";
  denyReason: string | null;
  events: number | null;
  hashChainVerified: boolean;
  store: string | null;
} {
  for (const line of stdout.split("\n")) {
    const match = VERDICT_LINE.exec(line);
    if (match === null) {
      continue;
    }
    const storeLine = STORE_LINE.exec(stdout.split("\n").find((candidate) => candidate.startsWith("store ")) ?? "");
    return {
      runId: match[1] ?? null,
      verdict: match[2] === "executed" ? "executed" : "denied",
      denyReason: match[3] ?? null,
      events: Number.parseInt(match[5] ?? "0", 10),
      hashChainVerified: match[6] === "true",
      store: storeLine === null ? null : (storeLine[1] ?? null),
    };
  }
  return {
    runId: null,
    verdict: "unparsed",
    denyReason: null,
    events: null,
    hashChainVerified: false,
    store: null,
  };
}

export interface UiRunResult extends RunReceipt {
  stderr: string;
}

/** Execute one governed run through the trusted core binary. */
export function executeForUi(
  core: string,
  store: string,
  command: string,
  allow: string[],
  approve: boolean,
): UiRunResult {
  const argv = splitArgs(command);
  const forwarded = [
    "run",
    "--store",
    store,
    ...allow.flatMap((program) => ["--allow", program]),
    ...(approve ? ["--approve"] : []),
    "--",
    ...argv,
  ];
  const startedAt = Date.now();
  const result = spawnSync(core, forwarded, { encoding: "utf8" });
  const stdout = result.stdout ?? "";
  const parsed = parseRunReceipt(stdout);
  return {
    at: new Date().toISOString(),
    runId: parsed.runId,
    verdict: parsed.verdict,
    denyReason: parsed.denyReason,
    exitCode: result.status ?? null,
    events: parsed.events,
    hashChainVerified: parsed.hashChainVerified,
    durationMs: Date.now() - startedAt,
    argv,
    command: joinArgs(argv),
    allowed: allow,
    approved: approve,
    stdout: stdout.slice(0, 8192),
    store: parsed.store,
    stderr: (result.stderr ?? "").slice(0, 8192),
  };
}

/** Default durable store for GUI sessions. */
export function defaultStore(): string {
  return join(homedir(), ".saber", "audit");
}

function sandboxBackend(): string {
  if (platform() === "darwin") {
    return "darwin://seatbelt-v1";
  }
  if (platform() === "linux") {
    return "linux://bwrap-v1";
  }
  return "fail-closed (no OS backend)";
}

function gitBranch(): string {
  try {
    const head = readFileSync(join(process.cwd(), ".git", "HEAD"), "utf8").trim();
    if (head.startsWith("ref: refs/heads/")) {
      return head.slice("ref: refs/heads/".length);
    }
    return head.slice(0, 7);
  } catch {
    return "—";
  }
}

/** Both-language dictionary; exported so tests can prove key parity. */
export function uiDictionary(): Record<string, { zh: string; en: string }> {
  return UI_STRINGS;
}

const HISTORY_LIMIT = 200;
const BODY_LIMIT = 65536;

/** Start the console server on 127.0.0.1 and return it with its port. */
export function startUiServer(options: {
  core: string;
  port?: number;
  store?: string;
}): Promise<{ server: Server; port: number; store: string }> {
  const store = options.store ?? defaultStore();
  const startedAt = new Date().toISOString();
  const history: RunReceipt[] = [];
  const boot: StudioBootState = {
    workspace: basename(process.cwd()),
    branch: gitBranch(),
    store,
    core: options.core,
    platform: `${platform()} ${process.arch}`,
    sandboxBackend: sandboxBackend(),
    node: process.versions.node,
    version: "0.0.0",
    port: 0,
    startedAt,
  };
  const server = createServer((request, response) => {
    const url = request.url ?? "/";
    if (request.method === "GET" && (url === "/" || url === "/index.html")) {
      // The page is static for the server's lifetime: revalidation with the
      // ETag returns 304, and gzip-capable clients get the ~5x smaller body.
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304, { etag });
        response.end();
        return;
      }
      const acceptsGzip = (request.headers["accept-encoding"] ?? "").includes("gzip");
      if (acceptsGzip) {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-encoding": "gzip",
          vary: "accept-encoding",
          etag,
        });
        response.end(gzippedPage);
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", etag });
      response.end(pageHtml);
      return;
    }
    if (request.method === "GET" && url === "/api/state") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          workspace: boot.workspace,
          branch: boot.branch,
          store,
          core: options.core,
          platform: boot.platform,
          sandboxBackend: boot.sandboxBackend,
          node: boot.node,
          version: boot.version,
          port: listeningPort,
          startedAt,
          uptimeMs: Date.now() - new Date(startedAt).getTime(),
          runs: history.length,
        }),
      );
      return;
    }
    if (request.method === "GET" && url === "/api/history") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ runs: [...history].reverse() }));
      return;
    }
    if (request.method === "POST" && url === "/api/run") {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
        if (body.length > BODY_LIMIT) {
          request.destroy();
        }
      });
      request.on("end", () => {
        let parsed: { command?: unknown; allow?: unknown; approve?: unknown };
        try {
          parsed = JSON.parse(body) as typeof parsed;
        } catch {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "invalid_json" }));
          return;
        }
        const command = typeof parsed.command === "string" ? parsed.command.trim() : "";
        if (command.length === 0) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "empty_command" }));
          return;
        }
        const allow = Array.isArray(parsed.allow)
          ? parsed.allow.filter((entry): entry is string => typeof entry === "string")
          : [];
        const approve = parsed.approve === true;
        const result = executeForUi(options.core, store, command, allow, approve);
        history.push(result);
        if (history.length > HISTORY_LIMIT) {
          history.shift();
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(result));
      });
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  let listeningPort = 0;
  let pageHtml = "";
  let gzippedPage: Buffer = Buffer.alloc(0);
  let etag = "";
  return new Promise((resolve) => {
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      listeningPort = typeof address === "object" && address !== null ? address.port : (options.port ?? 0);
      pageHtml = createUiPage({ ...boot, port: listeningPort });
      gzippedPage = gzipSync(pageHtml);
      etag = `"${createHash("sha256").update(pageHtml).digest("hex").slice(0, 32)}"`;
      resolve({ server, port: listeningPort, store });
    });
  });
}
