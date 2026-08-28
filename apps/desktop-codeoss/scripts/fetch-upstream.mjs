#!/usr/bin/env node
import { createHash } from "node:crypto";
/**
 * S26-WP02 — reproducible, atomic upstream source cache.
 *
 * Downloads the commit-addressed Code-OSS archive pinned by
 * upstream.lock.json into an ignored cache, verifies its SHA-256 and only
 * then promotes it by atomic rename. Interrupted or mismatched fetches are
 * deleted and can never become build inputs. `--offline` verifies the
 * existing cache without any network access. Symbolic refs, missing digests
 * and non-https origins are refused before anything is fetched. No upstream
 * code is ever executed here.
 */
import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCK_PATH = join(DESKTOP_ROOT, "upstream.lock.json");
export const CACHE_ROOT = join(DESKTOP_ROOT, ".cache");

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SYMBOLIC_REFS = new Set(["main", "master", "head", "develop", "trunk"]);

export function loadLock(path = LOCK_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Fail-closed lock validation; returns every problem found. */
export function validateLock(lock) {
  const errors = [];
  if (lock.schema_version !== 1) {
    errors.push("schema_version must be 1");
  }
  const source = lock.source ?? {};
  if (typeof source.repository !== "string" || !source.repository.startsWith("https://")) {
    errors.push("source.repository must be an https URL");
  }
  if (typeof source.ref !== "string" || source.ref.length === 0) {
    errors.push("source.ref is required");
  } else if (SYMBOLIC_REFS.has(source.ref.toLowerCase())) {
    errors.push(`source.ref "${source.ref}" is symbolic; pin a released tag`);
  }
  if (typeof source.commit !== "string" || !COMMIT_PATTERN.test(source.commit)) {
    errors.push("source.commit must be a full 40-hex commit sha, never a moving ref");
  }
  if (typeof source.archive_url !== "string" || !source.archive_url.startsWith("https://")) {
    errors.push("source.archive_url must be an https URL");
  } else if (
    typeof source.commit === "string" &&
    COMMIT_PATTERN.test(source.commit) &&
    !source.archive_url.endsWith(`/tar.gz/${source.commit}`)
  ) {
    errors.push("source.archive_url must address the immutable commit, not a ref");
  }
  if (typeof source.archive_sha256 !== "string" || !SHA256_PATTERN.test(source.archive_sha256)) {
    errors.push("source.archive_sha256 must be a full sha-256 digest");
  }
  const toolchain = lock.toolchain ?? {};
  if (typeof toolchain.node !== "string" || !VERSION_PATTERN.test(toolchain.node)) {
    errors.push("toolchain.node must be an exact x.y.z version");
  }
  for (const patch of lock.patches ?? []) {
    if (!COMMIT_PATTERN.test(patch.expected_base_commit ?? "")) {
      errors.push(`patch ${patch.id ?? "?"} must pin expected_base_commit`);
    }
    if (patch.expected_base_commit !== source.commit) {
      errors.push(`patch ${patch.id ?? "?"} base commit does not match the locked upstream commit`);
    }
    for (const field of ["id", "file", "owner", "rationale", "security_impact"]) {
      if (typeof patch[field] !== "string" || patch[field].length === 0) {
        errors.push(`patch ${patch.id ?? "?"} is missing ${field}`);
      }
    }
    if (!Array.isArray(patch.upstream_files) || patch.upstream_files.length === 0) {
      errors.push(`patch ${patch.id ?? "?"} must declare the upstream files it touches`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Canonical commit-addressed cache path for one lock. */
export function archivePath(lock, cacheRoot = CACHE_ROOT) {
  return join(cacheRoot, "upstream", `${lock.source.commit}.tar.gz`);
}

export function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolveHash(hash.digest("hex")))
      .on("error", reject);
  });
}

async function downloadTo(url, target) {
  let response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch (error) {
    throw new Error(`download failed: ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok || response.body === null) {
    throw new Error(`download failed: HTTP ${response.status} for ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
}

/**
 * Verify-or-fetch one lock. `offline` never touches the network. Returns
 * { path, digest, mode } or throws with a precise reason.
 */
export async function ensureUpstream(lock, { cacheRoot = CACHE_ROOT, offline = false } = {}) {
  const validation = validateLock(lock);
  if (!validation.ok) {
    throw new Error(`upstream.lock.json rejected:\n  - ${validation.errors.join("\n  - ")}`);
  }
  const target = archivePath(lock, cacheRoot);
  if (existsSync(target)) {
    const digest = await sha256File(target);
    if (digest !== lock.source.archive_sha256) {
      throw new Error(
        `cached archive digest mismatch for ${lock.source.commit}: got ${digest}, lock pins ${lock.source.archive_sha256}; remove the corrupt cache entry and re-fetch`,
      );
    }
    return { path: target, digest, mode: offline ? "offline-verified" : "cache-verified" };
  }
  if (offline) {
    throw new Error(
      `offline mode: ${target} is absent; populate the cache on a networked machine first (pnpm desktop:upstream:fetch)`,
    );
  }
  const temporary = `${target}.tmp-${process.pid}`;
  rmSync(temporary, { force: true });
  try {
    await downloadTo(lock.source.archive_url, temporary);
    const digest = await sha256File(temporary);
    if (digest !== lock.source.archive_sha256) {
      throw new Error(
        `downloaded archive digest mismatch for ${lock.source.commit}: got ${digest}, lock pins ${lock.source.archive_sha256}`,
      );
    }
    if (!statSync(temporary).isFile()) {
      throw new Error("download did not produce a regular file");
    }
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  return { path: target, digest: lock.source.archive_sha256, mode: "fetched" };
}

async function main() {
  const offline = process.argv.includes("--offline");
  const lock = loadLock();
  const result = await ensureUpstream(lock, { offline });
  console.log(`${result.mode}: ${result.path}`);
  console.log(`sha256 ${result.digest}`);
  console.log(`commit ${lock.source.commit} (${lock.source.ref}, ${lock.source.license})`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(`fetch-upstream: ${error.message}`);
    process.exit(1);
  });
}
