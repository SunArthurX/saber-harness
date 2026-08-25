const WINDOWS_COMMAND_SHIMS = new Set(["corepack", "pnpm"]);
const SAFE_SHIM_ARGUMENT = /^[A-Za-z0-9@._:/=-]+$/;

/** Builds a cross-platform process invocation and rejects unsafe Windows shim arguments. */
export function commandSpec(
  name,
  args,
  { platform = process.platform, comspec = process.env.ComSpec ?? "cmd.exe" } = {},
) {
  if (platform !== "win32" || !WINDOWS_COMMAND_SHIMS.has(name)) return { command: name, args };
  if (![name, ...args].every((part) => SAFE_SHIM_ARGUMENT.test(part))) {
    throw new Error(`unsafe argument for Windows command shim: ${name}`);
  }
  return { command: comspec, args: ["/d", "/s", "/c", [name, ...args].join(" ")] };
}
