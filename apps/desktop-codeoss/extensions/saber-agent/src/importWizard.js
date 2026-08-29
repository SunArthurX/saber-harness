/**
 * S33-WP01 — import wizard and consent.
 *
 * Versioned adapters import authorized external CodingAgent
 * conversations: the source picker labels official export, API, local
 * artifact and manual upload; consent shows requested files, expected
 * data classes, processing locality and retention BEFORE anything is
 * read; validation covers size, media, schema, parser version and
 * malicious attachment content; import is resumable and idempotent,
 * and cancellation leaves no half-authoritative records. Unsupported
 * fields stay visible (CDX-03, ZCD-03, ZCD-09).
 */

/** Import source kinds. */
const SOURCE_KINDS = Object.freeze(["official-export", "api", "local-artifact", "manual-upload"]);

/** Supported adapters with their fixture formats. */
const ADAPTERS = Object.freeze({
  "codex-export": Object.freeze({
    parserVersion: 1,
    mediaType: "application/json",
    maxBytes: 64 * 1024 * 1024,
    shape: Object.freeze(["conversations", "format", "format_version"]),
  }),
  "claude-export": Object.freeze({
    parserVersion: 2,
    mediaType: "application/json",
    maxBytes: 64 * 1024 * 1024,
    shape: Object.freeze(["chats", "format", "format_version"]),
  }),
});

/** The consent manifest shown before anything is read. */
function consentManifest(request) {
  return Object.freeze({
    sourceKind: request.sourceKind,
    format: request.format,
    requestedFiles: Object.freeze(request.files ?? []),
    expectedDataClasses: Object.freeze(["conversation-text", "timestamps", "model-metadata"]),
    processing: "local-only",
    retention: "until-user-deletes",
    cloudPlaintext: false,
  });
}

/** Validate an import payload; returns every failure. */
function validateImport(source) {
  const failures = [];
  const adapter = ADAPTERS[source?.format];
  if (!adapter) {
    return Object.freeze({ failures: Object.freeze(["unsupported-format"]), parserVersion: null });
  }
  if ((source.sizeBytes ?? 0) > adapter.maxBytes) {
    failures.push("size-over-limit");
  }
  if (source.mediaType !== adapter.mediaType) {
    failures.push("media-mismatch");
  }
  const document = source.document;
  if (!document || typeof document !== "object") {
    failures.push("schema-invalid");
    return Object.freeze({ failures: Object.freeze(failures), parserVersion: adapter.parserVersion });
  }
  for (const key of adapter.shape) {
    if (!(key in document)) {
      failures.push(`schema-missing:${key}`);
    }
  }
  if (document.format_version !== adapter.parserVersion) {
    failures.push("parser-version-mismatch");
  }
  // Malicious attachment content: no executable payloads inside imports.
  const serialized = JSON.stringify(document);
  if (serialized.includes("data:application/x-executable") || serialized.includes("application/x-msdownload")) {
    failures.push("malicious-attachment-content");
  }
  return Object.freeze({ failures: Object.freeze(failures), parserVersion: adapter.parserVersion });
}

/** Canonicalize one conversation through a named adapter. */
function canonicalize(source) {
  const validation = validateImport(source);
  if (validation.failures.length > 0) {
    throw new Error(`import_invalid:${validation.failures.join(",")}`);
  }
  const document = source.document;
  const unsupported = [];
  const canonical = [];
  const entries = document.conversations ?? document.chats ?? [];
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry)) {
      const known = ["id", "uuid", "title", "name", "messages", "turns", "metadata", "extra"].includes(key);
      if (!known && value !== undefined) {
        unsupported.push(key);
      }
    }
    const messages = (entry.messages ?? entry.turns ?? []).map((message) => ({
      role: message.role ?? message.sender ?? "unknown",
      text: message.text ?? message.content ?? "",
      atMs: message.at_ms ?? message.timestamp ?? 0,
    }));
    canonical.push({
      sourceId: entry.id ?? entry.uuid,
      title: entry.title ?? entry.name,
      messages,
      adapter: source.format,
      parserVersion: validation.parserVersion,
      unsupportedFields: [...new Set(unsupported)],
    });
  }
  return Object.freeze(canonical.map((item) => Object.freeze({ ...item, messages: Object.freeze(item.messages) })));
}

/** Import state machine: resumable, idempotent, cancel-safe. */
const IMPORT_STATES = Object.freeze(["consent-pending", "validating", "importing", "paused", "imported", "cancelled"]);

function importSession() {
  let state = "consent-pending";
  const canonical = [];
  return Object.freeze({
    get state() {
      return state;
    },
    consent() {
      if (state !== "consent-pending") throw new Error("invalid_transition");
      state = "validating";
    },
    validated(records) {
      if (state !== "validating") throw new Error("invalid_transition");
      canonical.splice(0, canonical.length, ...records);
      state = "importing";
    },
    pause() {
      if (state !== "importing") throw new Error("invalid_transition");
      state = "paused";
    },
    resume() {
      if (state !== "paused") throw new Error("invalid_transition");
      state = "importing";
    },
    finish() {
      if (state !== "importing") throw new Error("invalid_transition");
      state = "imported";
    },
    cancel() {
      // Cancellation discards every half-authoritative record.
      canonical.splice(0, canonical.length);
      state = "cancelled";
    },
    records() {
      return Object.freeze([...canonical]);
    },
  });
}

module.exports = {
  ADAPTERS,
  IMPORT_STATES,
  SOURCE_KINDS,
  canonicalize,
  consentManifest,
  importSession,
  validateImport,
};
