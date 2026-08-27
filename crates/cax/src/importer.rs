//! First importers: pure parsers with recomputable evidence (ADR-014).

use crate::record::{
    CAX_SCHEMA_VERSION, CaxEntry, CaxError, CaxRecord, CaxSession, CaxSource, EntryRole,
    SourceFormat, entry_digest_of, raw_digest_of, record_digest_of, record_id_for,
};

/// Scope the imported record belongs to.
#[derive(Clone, Debug)]
pub struct ImportScope {
    /// Target tenant.
    pub tenant: String,
    /// Target workspace.
    pub workspace: String,
}

/// Build a validated record from raw bytes and parsed entries.
fn assemble(
    scope: &ImportScope,
    origin_uri: &str,
    format: SourceFormat,
    raw: &[u8],
    entries: Vec<CaxEntry>,
    session: CaxSession,
) -> Result<CaxRecord, CaxError> {
    if entries.is_empty()
        || scope.tenant.is_empty()
        || scope.workspace.is_empty()
        || origin_uri.is_empty()
    {
        return Err(CaxError::Malformed);
    }
    let raw_digest = raw_digest_of(raw);
    let record_id = record_id_for(&scope.tenant, &scope.workspace, &raw_digest);
    let record = CaxRecord {
        record_id,
        schema_version: CAX_SCHEMA_VERSION.to_owned(),
        tenant: scope.tenant.clone(),
        workspace: scope.workspace.clone(),
        source: CaxSource {
            origin_uri: origin_uri.to_owned(),
            format,
            raw_digest,
        },
        session,
        entries,
        record_digest: String::new(),
    };
    let record = CaxRecord {
        record_digest: record_digest_of(&record),
        ..record
    };
    record.validate()?;
    Ok(record)
}

/// Import a JSONL transcript: one `{"role": ..., "content": ...}` object
/// per line. Unknown roles map to `System`; blank lines are skipped.
///
/// # Errors
///
/// [`CaxError::Malformed`] for unparseable lines or an empty result.
pub fn import_jsonl_transcript(
    scope: &ImportScope,
    origin_uri: &str,
    raw: &[u8],
) -> Result<CaxRecord, CaxError> {
    let text = std::str::from_utf8(raw).map_err(|_| CaxError::Malformed)?;
    let mut entries = Vec::new();
    let mut agent = None;
    let mut session = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value: serde_json::Value =
            serde_json::from_str(trimmed).map_err(|_| CaxError::Malformed)?;
        let role = match value.get("role").and_then(serde_json::Value::as_str) {
            Some("user") => EntryRole::User,
            Some("assistant") => EntryRole::Assistant,
            Some("tool") => EntryRole::Tool,
            _ => EntryRole::System,
        };
        let content = value
            .get("content")
            .and_then(serde_json::Value::as_str)
            .ok_or(CaxError::Malformed)?
            .to_owned();
        let occurred_at_ms = value
            .get("timestamp_ms")
            .and_then(serde_json::Value::as_u64);
        if agent.is_none()
            && let Some(agent_name) = value.get("agent").and_then(serde_json::Value::as_str)
        {
            agent = Some(agent_name.to_owned());
        }
        if session.is_none()
            && let Some(session_id) = value.get("session").and_then(serde_json::Value::as_str)
        {
            session = Some(session_id.to_owned());
        }
        entries.push(CaxEntry {
            content_digest: entry_digest_of(&content),
            role,
            content,
            occurred_at_ms,
        });
    }
    assemble(
        scope,
        origin_uri,
        SourceFormat::JsonlTranscript,
        raw,
        entries,
        CaxSession { agent, session },
    )
}

/// Import a Markdown transcript: turns prefixed with `**Role:**` or
/// `Role:` headers; the remainder of a header line belongs to the turn.
///
/// # Errors
///
/// [`CaxError::Malformed`] when no turn parses.
pub fn import_markdown_transcript(
    scope: &ImportScope,
    origin_uri: &str,
    raw: &[u8],
) -> Result<CaxRecord, CaxError> {
    let text = std::str::from_utf8(raw).map_err(|_| CaxError::Malformed)?;
    let mut entries: Vec<CaxEntry> = Vec::new();
    let mut current: Option<(EntryRole, String)> = None;
    for line in text.lines() {
        let trimmed = line.trim();
        let header_role = parse_header(trimmed);
        if let Some((role, rest)) = header_role {
            if let Some((previous_role, body)) = current.take() {
                let content = body.trim().to_owned();
                if !content.is_empty() {
                    entries.push(CaxEntry {
                        content_digest: entry_digest_of(&content),
                        role: previous_role,
                        content,
                        occurred_at_ms: None,
                    });
                }
            }
            current = Some((role, rest));
        } else if let Some((role, mut body)) = current.take() {
            body.push_str(line);
            body.push('\n');
            current = Some((role, body));
        }
    }
    if let Some((role, body)) = current {
        let content = body.trim().to_owned();
        if !content.is_empty() {
            entries.push(CaxEntry {
                content_digest: entry_digest_of(&content),
                role,
                content,
                occurred_at_ms: None,
            });
        }
    }
    assemble(
        scope,
        origin_uri,
        SourceFormat::MarkdownTranscript,
        raw,
        entries,
        CaxSession {
            agent: None,
            session: None,
        },
    )
}

/// Parse one markdown turn header: `**Role:** rest` or `Role: rest`.
fn parse_header(line: &str) -> Option<(EntryRole, String)> {
    let (token, rest) = if let Some(inner) = line.strip_prefix("**") {
        let (role, rest) = inner.split_once(":**")?;
        (role, rest.strip_prefix(' ').unwrap_or(rest).to_owned())
    } else {
        let (role, rest) = line.split_once(':')?;
        if !role.chars().all(char::is_alphabetic) {
            return None;
        }
        (role, rest.strip_prefix(' ').unwrap_or(rest).to_owned())
    };
    let matched = match token.trim().to_ascii_lowercase().as_str() {
        "user" => EntryRole::User,
        "assistant" => EntryRole::Assistant,
        "tool" => EntryRole::Tool,
        "system" => EntryRole::System,
        _ => return None,
    };
    let mut body = rest;
    body.push('\n');
    Some((matched, body))
}
