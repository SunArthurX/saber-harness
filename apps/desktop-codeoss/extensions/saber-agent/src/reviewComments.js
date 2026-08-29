/**
 * S31-WP02 — durable review comments and keyboard navigation.
 *
 * Comments bind path, side, a line/hunk fingerprint and the revision
 * they were written against; when the tree moves, stale comments are
 * MARKED, never silently relocated. Keep/Reject on a hunk creates a
 * review intent — the projection never mutates files directly.
 */

/** Comment sides. */
const SIDES = Object.freeze(["old", "new"]);

/** A durable review comment (S31-WP02 / CLD-06). */
class ReviewComment {
  constructor({ id, path, side, line, hunkFingerprint, revision, body, author }) {
    if (!id || !path || !SIDES.includes(side) || !hunkFingerprint || !revision) {
      throw new Error("invalid_comment_binding");
    }
    this.id = id;
    this.path = path;
    this.side = side;
    this.line = line ?? null;
    this.hunkFingerprint = hunkFingerprint;
    this.revision = revision;
    this.body = String(body ?? "");
    this.author = author ?? "user";
    Object.freeze(this);
  }
}

/**
 * Thread of comments over one change set revision. Comments survive
 * restart as durable Task inputs; a changed fingerprint marks them
 * stale instead of moving them.
 */
class CommentThread {
  #comments = new Map();

  add(comment) {
    const durable = comment instanceof ReviewComment ? comment : new ReviewComment(comment);
    this.#comments.set(durable.id, durable);
    return durable;
  }

  /** Mark comments whose fingerprint no longer matches the revision. */
  reconcile(currentFingerprints) {
    const stale = [];
    for (const comment of this.#comments.values()) {
      if (!currentFingerprints.includes(comment.hunkFingerprint)) {
        stale.push(comment.id);
      }
    }
    return Object.freeze({ stale: Object.freeze(stale), total: this.#comments.size });
  }

  list() {
    return Object.freeze([...this.#comments.values()]);
  }
}

/** Keep/Reject creates a review intent, never a direct mutation. */
function hunkIntent(action, path, hunkFingerprint, revision) {
  if (action !== "keep" && action !== "reject") {
    throw new Error("invalid_hunk_action");
  }
  return Object.freeze({
    kind: "review.hunk_intent",
    action,
    path,
    hunkFingerprint,
    revision,
    mutatesFiles: false,
  });
}

/**
 * Keyboard navigation contract (S31-WP02): file list → hunks → comments
 * → decisions, with visible focus and no pointer-only path.
 */
const KEYBOARD_NAVIGATION = Object.freeze([
  Object.freeze({ step: "file-list", key: "ArrowUp/ArrowDown" }),
  Object.freeze({ step: "hunks", key: "ArrowLeft/ArrowRight" }),
  Object.freeze({ step: "comments", key: "Enter to focus, Escape to return" }),
  Object.freeze({ step: "decisions", key: "Space to toggle, Enter to record" }),
]);

module.exports = {
  KEYBOARD_NAVIGATION,
  CommentThread,
  ReviewComment,
  SIDES,
  hunkIntent,
};
