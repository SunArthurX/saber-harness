/**
 * S31-WP05 — Boundary Diff.
 *
 * Summarizes what a change set alters AT THE BOUNDARY: new network
 * destinations, commands, secrets, capabilities, plugins, generated
 * executables, policy files, dependencies and migrations. Boundary
 * changes cannot hide inside ordinary code review — they surface as
 * their own review section with explicit acknowledgment.
 */

/** Boundary categories that always receive explicit review. */
const BOUNDARY_CATEGORIES = Object.freeze([
  "network-destinations",
  "commands",
  "secrets",
  "capabilities",
  "plugins",
  "generated-executables",
  "policy-files",
  "dependencies",
  "migrations",
]);

/** Path predicates per boundary category. */
const PATH_RULES = Object.freeze({
  "network-destinations": /(^|\/)(endpoints|urls|hosts)\.(json|ya?ml)$|https?:\/\//i,
  commands: /(^|\/)scripts?\//i,
  secrets: /(^|\/)\.env|secret|credential|private-key/i,
  capabilities: /(^|\/)capabilities?\.(json|ya?ml)$|(^|\/)saber\.json$/i,
  plugins: /(^|\/)plugins?\//i,
  "generated-executables": /\.(exe|dll|so|dylib|bin|appimage)$/i,
  "policy-files": /(^|\/)(policy|policies)\.(json|ya?ml)$|\.policy\.json$/i,
  dependencies: /(^|\/)(package\.json|pnpm-lock\.yaml|cargo\.toml|cargo\.lock|go\.(mod|sum)|requirements\.txt)$/i,
  migrations: /(^|\/)migrations?\//i,
});

/**
 * Diff the boundary between two path lists (baseline → current).
 * Every category that gains at least one path becomes an explicit
 * review item; removals are listed but never silent either.
 */
function boundaryDiff(baselinePaths, currentPaths) {
  const baseline = new Set(baselinePaths ?? []);
  const current = new Set(currentPaths ?? []);
  const added = [...current].filter((path) => !baseline.has(path));
  const removed = [...baseline].filter((path) => !current.has(path));
  const categories = {};
  for (const category of BOUNDARY_CATEGORIES) {
    const rule = PATH_RULES[category];
    const addedHits = added.filter((path) => rule.test(path));
    const removedHits = removed.filter((path) => rule.test(path));
    if (addedHits.length > 0 || removedHits.length > 0) {
      categories[category] = Object.freeze({
        added: Object.freeze(addedHits),
        removed: Object.freeze(removedHits),
        requiresExplicitReview: addedHits.length > 0,
      });
    }
  }
  return Object.freeze({
    categories: Object.freeze(categories),
    boundaryChanged: Object.keys(categories).length > 0,
    plainCodeReviewOnly: Object.keys(categories).length === 0,
    acknowledgmentRequired: Object.freeze(
      Object.keys(categories).filter((category) => categories[category].requiresExplicitReview),
    ),
  });
}

module.exports = {
  BOUNDARY_CATEGORIES,
  boundaryDiff,
};
