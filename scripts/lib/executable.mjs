const WINDOWS_COMMAND_SHIMS = new Set(["corepack", "pnpm"]);

/** Resolves package-manager shims without enabling a command shell. */
export function executableName(name, platform = process.platform) {
  return platform === "win32" && WINDOWS_COMMAND_SHIMS.has(name) ? `${name}.cmd` : name;
}
