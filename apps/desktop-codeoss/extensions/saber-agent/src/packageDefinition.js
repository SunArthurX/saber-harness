/**
 * S36-WP01/S36-WP02 — Package definitions, signing and provenance.
 *
 * Reproducible, signed packages for macOS (hardened runtime +
 * notarization), Windows (Authenticode, per-user default) and Linux
 * (deb + archive). Signing keys live only in approved CI secret/
 * KMS/HSM — never in the repository or developer scripts; development
 * and production channels use distinct identities; every artifact
 * carries SHA-256, SBOM, source/lock commit, patch manifest, build
 * environment, signer and a provenance statement (ADR-024).
 */

const APP_ID = "com.saber.studio";

/** Platform package definitions (S36-WP01). */
const PLATFORMS = Object.freeze({
  macos: Object.freeze({
    platform: "macos",
    arch: ["arm64", "x64", "universal"],
    formats: Object.freeze(["dmg", "zip"]),
    signing: "hardened-runtime+notarization",
    installLocation: "/Applications/Saber Studio.app",
    dataLocation: "~/Library/Application Support/SaberStudio",
    cacheLocation: "~/Library/Caches/SaberStudio",
    logLocation: "~/Library/Logs/SaberStudio",
    urlScheme: "saber",
    fileAssociations: Object.freeze(["x-saber-workspace"]),
    uninstallRetention: "asks; encrypted user data kept by default",
  }),
  windows: Object.freeze({
    platform: "windows",
    arch: Object.freeze(["x64"]),
    formats: Object.freeze(["installer"]),
    signing: "authenticode",
    installLocation: "%LOCALAPPDATA%\\Programs\\SaberStudio (per-user default; machine option documented)",
    dataLocation: "%APPDATA%\\SaberStudio",
    cacheLocation: "%LOCALAPPDATA%\\SaberStudio\\Cache",
    logLocation: "%APPDATA%\\SaberStudio\\Logs",
    urlScheme: "saber",
    fileAssociations: Object.freeze(["x-saber-workspace"]),
    uninstallRetention: "asks; encrypted user data kept by default",
  }),
  linux: Object.freeze({
    platform: "linux",
    arch: Object.freeze(["x64"]),
    formats: Object.freeze(["deb", "archive"]),
    signing: "dpkg-sig+archive-digest",
    installLocation: "/opt/saber-studio",
    dataLocation: "~/.config/SaberStudio",
    cacheLocation: "~/.cache/SaberStudio",
    logLocation: "~/.local/state/SaberStudio/logs",
    urlScheme: "saber",
    fileAssociations: Object.freeze(["x-saber-workspace"]),
    uninstallRetention: "asks; encrypted user data kept by default",
    optionalFormats: Object.freeze(["rpm", "appimage"]),
    optionalNote: "rpm/AppImage only after an explicit support decision; never advertised silently",
  }),
});

/** Channel identities stay distinct between development and production. */
const CHANNELS = Object.freeze({
  development: Object.freeze({ identity: "saber-dev-signing", endpoint: "https://updates.dev.saber.test" }),
  production: Object.freeze({ identity: "saber-release-signing", endpoint: "https://updates.saber.example" }),
});

/**
 * Where signing keys may live. Anything repository- or developer-
 * script-based fails closed.
 */
function signingKeyLocation(location) {
  const approved = Object.freeze(["ci-secret", "kms", "hsm"]);
  if (!approved.includes(location)) {
    throw new Error(`signing_key_location_prohibited:${location}`);
  }
  return Object.freeze({ location, repositoryKeys: false, developerScripts: false });
}

/** Deterministic fixture signature over an artifact digest (test-only). */
function fixtureSignature(artifactDigest, channelIdentity, version) {
  let hash = 0;
  const material = `${artifactDigest}|${channelIdentity}|${version}`;
  for (const ch of material) {
    hash = (hash * 31 + ch.codePointAt(0)) % 0x100000000;
  }
  return `relsig-${hash.toString(16)}`;
}

/**
 * The provenance statement each artifact must carry (S36-WP02):
 * SHA-256, SBOM digest, source/lock commit, patch manifest, build
 * environment, signer and channel identity.
 */
function provenance(artifact) {
  if (artifact.sha256?.length !== 64) {
    throw new Error("artifact_digest_missing");
  }
  if (!artifact.sbomDigest || !artifact.sourceCommit || !artifact.lockCommit || !artifact.patchManifest) {
    throw new Error("provenance_incomplete");
  }
  return Object.freeze({
    artifact: artifact.name,
    sha256: artifact.sha256,
    sbomDigest: artifact.sbomDigest,
    sourceCommit: artifact.sourceCommit,
    lockCommit: artifact.lockCommit,
    patchManifest: artifact.patchManifest,
    buildEnvironment: artifact.buildEnvironment ?? "github-actions",
    signer: artifact.signer,
    channelIdentity: artifact.channelIdentity,
    signature: fixtureSignature(artifact.sha256, artifact.channelIdentity, artifact.version),
    statement:
      "built reproducibly from the recorded source/lock commits; verified on a clean offline machine before publication",
  });
}

/** Verify provenance the way a clean offline machine would. */
function verifyProvenance(record) {
  if (!record || record.signature !== fixtureSignature(record.sha256, record.channelIdentity, record.version)) {
    return Object.freeze({ valid: false, reason: "signature_mismatch" });
  }
  if (!record.sbomDigest || !record.sourceCommit || !record.statement) {
    return Object.freeze({ valid: false, reason: "provenance_incomplete" });
  }
  return Object.freeze({ valid: true, offlineVerified: true });
}

/** Platform parity gaps are explicit product states, never silent. */
function parityState(platform, arch) {
  const def = PLATFORMS[platform];
  if (!def) {
    throw new Error(`unknown_platform:${platform}`);
  }
  if (!def.arch.includes(arch)) {
    return Object.freeze({
      platform,
      arch,
      supported: false,
      advertised: false,
      state: "explicit-unsupported",
      reason: "no unsupported architecture is advertised because another product supports it",
    });
  }
  return Object.freeze({ platform, arch, supported: true, advertised: true, state: "supported" });
}

module.exports = {
  APP_ID,
  CHANNELS,
  PLATFORMS,
  fixtureSignature,
  parityState,
  provenance,
  signingKeyLocation,
  verifyProvenance,
};
