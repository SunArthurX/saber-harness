import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

function appendUnique(target, seen, candidate) {
  if (!candidate || seen.has(candidate)) return;
  seen.add(candidate);
  target.push(candidate);
}

/** Returns deterministic locations where an exact, already-installed Node.js runtime may exist. */
export function nodeExecutableCandidates(
  version,
  { env = process.env, home = homedir(), platform = process.platform, execPath = process.execPath } = {},
) {
  const binary = platform === "win32" ? "node.exe" : "node";
  const candidates = [];
  const seen = new Set();
  const add = (candidate) => appendUnique(candidates, seen, candidate);

  add(env.SABER_NODE_PATH);
  add(execPath);
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (directory) add(join(directory, binary));
  }

  const nvmRoot = env.NVM_DIR ?? join(home, ".nvm");
  add(join(nvmRoot, "versions", "node", `v${version}`, "bin", binary));
  if (env.NVM_HOME) add(join(env.NVM_HOME, `v${version}`, binary));
  if (env.NVM_SYMLINK) add(join(env.NVM_SYMLINK, binary));

  const voltaRoot = env.VOLTA_HOME ?? join(home, ".volta");
  add(join(voltaRoot, "bin", binary));

  const asdfRoot = env.ASDF_DATA_DIR ?? join(home, ".asdf");
  add(join(asdfRoot, "installs", "nodejs", version, "bin", binary));

  const miseRoot = env.MISE_DATA_DIR ?? join(home, ".local", "share", "mise");
  add(join(miseRoot, "installs", "node", version, "bin", binary));

  const fnmRoot = env.FNM_DIR ?? join(home, ".local", "share", "fnm");
  add(join(fnmRoot, "node-versions", `v${version}`, "installation", "bin", binary));

  const nodenvRoot = env.NODENV_ROOT ?? join(home, ".nodenv");
  add(join(nodenvRoot, "versions", version, "bin", binary));

  return candidates;
}

function installedNodeVersion(executable) {
  const result = spawnSync(executable, ["--version"], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  return result.stdout.trim().replace(/^v/, "");
}

/** Finds an installed Node.js executable whose reported version exactly matches the repository pin. */
export function resolvePinnedNode(
  version,
  { candidates = nodeExecutableCandidates(version), exists = existsSync, readVersion = installedNodeVersion } = {},
) {
  return candidates.find((candidate) => exists(candidate) && readVersion(candidate) === version);
}

/** Prepends the selected Node.js directory so env-based package-manager shims use the same runtime. */
export function environmentForNode(executable, env = process.env) {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const currentPath = env[pathKey] ?? "";
  return {
    ...env,
    [pathKey]: [dirname(executable), currentPath].filter(Boolean).join(delimiter),
  };
}
