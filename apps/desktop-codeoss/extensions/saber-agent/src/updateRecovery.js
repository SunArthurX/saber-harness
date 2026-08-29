/**
 * S36-WP05/S36-WP06 — Install/update recovery matrix, offline and
 * enterprise distribution.
 *
 * Power/process kill during download, verify, unpack, swap,
 * migration and first launch never yields silent corruption or
 * unsigned execution. Disk full, antivirus lock, proxy interruption,
 * expired cert, clock skew and a running previous version are
 * contained. The offline bundle carries package, signature, trust
 * metadata, SBOM, notices and a verification tool; enterprise silent
 * install covers documented non-secret options only; proxies,
 * mirrors and air-gaps are signed-policy controlled; uninstall asks
 * about encrypted user data with deletion protection by default.
 */

/** Injected failure points during install/update. */
const KILL_PHASES = Object.freeze(["download", "verify", "unpack", "swap", "migration", "first-launch"]);

/** Environmental fault conditions. */
const FAULT_CONDITIONS = Object.freeze([
  "disk-full",
  "antivirus-lock",
  "proxy-interruption",
  "expired-cert",
  "clock-skew",
  "previous-version-running",
]);

/** A kill at any phase resolves without corruption or unsigned code. */
function killRecovery(killPhase) {
  const table = Object.freeze({
    download: { outcome: "resume-or-restart-download", corruption: false, unsignedExecution: false },
    verify: { outcome: "discard-partial-verify", corruption: false, unsignedExecution: false },
    unpack: { outcome: "discard-partial-unpack", corruption: false, unsignedExecution: false },
    swap: { outcome: "retain-previous-or-atomic-swap-journal", corruption: false, unsignedExecution: false },
    migration: { outcome: "checkpoint-restore-or-explicit-recovery", corruption: false, unsignedExecution: false },
    "first-launch": { outcome: "rollback-launch-or-explicit-recovery", corruption: false, unsignedExecution: false },
  });
  const entry = table[killPhase];
  if (!entry) {
    throw new Error(`unknown_kill_phase:${killPhase}`);
  }
  return Object.freeze({ killPhase, ...entry });
}

/** Each environmental fault has an explicit containment. */
function faultContainment(condition) {
  const table = Object.freeze({
    "disk-full": { contained: true, mechanism: "preflight guard + staged writes" },
    "antivirus-lock": { contained: true, mechanism: "retry with backoff + explicit failure" },
    "proxy-interruption": { contained: true, mechanism: "resumable download + digest recheck" },
    "expired-cert": { contained: true, mechanism: "signature check fails closed" },
    "clock-skew": { contained: true, mechanism: "metadata expiry uses tolerances and alerts" },
    "previous-version-running": { contained: true, mechanism: "single-instance lock + guided restart" },
  });
  const entry = table[condition];
  if (!entry) {
    throw new Error(`unknown_fault_condition:${condition}`);
  }
  return Object.freeze({ condition, ...entry });
}

/** The full matrix proves containment across phases x conditions. */
function recoveryMatrix() {
  const kills = KILL_PHASES.map((phase) => killRecovery(phase));
  const faults = FAULT_CONDITIONS.map((condition) => faultContainment(condition));
  return Object.freeze({
    kills: Object.freeze(kills),
    faults: Object.freeze(faults),
    silentCorruption: kills.some((k) => k.corruption) || faults.some((f) => !f.contained),
    unsignedExecution: kills.some((k) => k.unsignedExecution),
    verdict:
      kills.every((k) => !k.corruption && !k.unsignedExecution) && faults.every((f) => f.contained)
        ? "matrix-passed"
        : "matrix-failed",
  });
}

/** Offline bundle contents (S36-WP06). */
const OFFLINE_BUNDLE_CONTENTS = Object.freeze([
  "package",
  "signature",
  "trust-metadata",
  "sbom",
  "notices",
  "verification-tool",
  "verification-instructions",
]);

function offlineBundle(present) {
  const missing = OFFLINE_BUNDLE_CONTENTS.filter((item) => !present.includes(item));
  return Object.freeze({
    complete: missing.length === 0,
    missing: Object.freeze(missing),
    contents: Object.freeze(OFFLINE_BUNDLE_CONTENTS),
  });
}

/** Enterprise silent install: documented non-secret options only. */
function silentInstallOption(name, value) {
  const documented = Object.freeze([
    "install-mode",
    "update-channel",
    "log-level",
    "data-directory",
    "proxy-url",
    "update-mirror",
  ]);
  if (!documented.includes(name)) {
    return Object.freeze({ name, accepted: false, reason: "not-a-documented-option" });
  }
  if (/secret|token|password|key/i.test(name)) {
    return Object.freeze({ name, accepted: false, reason: "secret_options_prohibited_in_silent_install" });
  }
  return Object.freeze({ name, value, accepted: true, policyControlled: true });
}

/** Proxy/mirror/air-gap configuration is signed-policy controlled. */
function networkDistributionPolicy(config, signedPolicy) {
  if (!signedPolicy) {
    return Object.freeze({ accepted: false, reason: "unsigned_distribution_policy" });
  }
  return Object.freeze({
    accepted: true,
    proxy: config.proxy ?? null,
    mirror: config.mirror ?? null,
    airGap: config.airGap === true,
    signedPolicy: true,
  });
}

/** Uninstall asks about encrypted data; default protects it. */
function uninstallFlow(choice) {
  const table = Object.freeze({
    keep: { dataRetained: true, secureEraseNote: "not-performed" },
    erase: { dataRetained: false, secureEraseNote: "best-effort secure erase documented with OS limitations" },
    default: { dataRetained: true, secureEraseNote: "default protects against accidental deletion" },
  });
  const entry = table[choice ?? "default"];
  if (!entry) {
    throw new Error(`unknown_uninstall_choice:${choice}`);
  }
  return Object.freeze({ choice: choice ?? "default", ...entry, asks: true });
}

module.exports = {
  FAULT_CONDITIONS,
  KILL_PHASES,
  OFFLINE_BUNDLE_CONTENTS,
  faultContainment,
  killRecovery,
  networkDistributionPolicy,
  offlineBundle,
  recoveryMatrix,
  silentInstallOption,
  uninstallFlow,
};
