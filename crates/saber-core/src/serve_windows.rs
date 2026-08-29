//! S27 Windows named-pipe supervision transport.
//!
//! Mirrors the unix endpoint (serve.rs) over the contracted
//! `\\.\pipe\saber-<workspace>` endpoint using the safe `interprocess`
//! local-socket abstraction: first-listener semantics so an existing Core
//! can never be silently replaced, the operating system's default per-user
//! pipe ACL restricting access to the current logon identity, and the
//! local-socket flavor rejecting remote pipe access. The one-time
//! bootstrap token and the lifecycle method set behave exactly like the
//! unix side. No unsafe code: the workspace forbids it.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use interprocess::local_socket::{
    GenericNamespaced, ListenerOptions, Stream as LocalStream, ToNsName, prelude::*,
};
use saber_core_protocol::{ControlMethod, DesktopPlatform, MAX_FRAME_BYTES, PROTOCOL_VERSION};
use saber_event_store::EventStore;

use crate::KeyFileProvider;

const LINE_LIMIT: usize = MAX_FRAME_BYTES + 1;
const TOKEN_BYTES: usize = 32;

/// Serve the workspace supervision endpoint until the process is stopped.
///
/// # Errors
///
/// Fails with a human-readable reason when the endpoint cannot be created,
/// the store cannot open or a connection loop fails unrecoverably.
pub fn serve(store_dir: &Path, workspace_id: &str) -> Result<(), String> {
    let address = saber_core_protocol::transport_address(DesktopPlatform::Windows, workspace_id)
        .map_err(|error| error.to_string())?;
    let pipe_name = address
        .strip_prefix(r"\\.\pipe\")
        .unwrap_or(&address)
        .to_ns_name::<GenericNamespaced>()
        .map_err(|error| format!("endpoint name rejected: {error}"))?;
    // First-listener semantics: creating the listener while another Core
    // still owns the same name fails instead of replacing it.
    let listener = ListenerOptions::new()
        .name(pipe_name)
        .create_sync()
        .map_err(|error| {
            format!("listener creation refused (an existing Core may own the endpoint): {error}")
        })?;

    std::fs::create_dir_all(store_dir).map_err(|_| "store directory unavailable".to_string())?;
    let provider = KeyFileProvider::new(store_dir);
    let store = EventStore::open(&store_dir.join("facts.db"), workspace_id, &provider)
        .map_err(|error| format!("store open failed: {error}"))?;
    let store = Arc::new(Mutex::new(store));

    let token = bootstrap_token()?;
    // The one and only channel the token ever travels: stdout of the
    // spawned process, captured by the desktop main process.
    println!("bootstrap-token {token}");
    std::io::stdout()
        .flush()
        .map_err(|error| error.to_string())?;
    println!("serving {address} workspace {workspace_id}");
    std::io::stdout()
        .flush()
        .map_err(|error| error.to_string())?;

    // One thread per connection: the desktop keeps several long-lived
    // connections open at once, so a serial accept loop would starve every
    // peer after the first.
    let token_spent = Arc::new(AtomicBool::new(false));
    for stream in listener.incoming() {
        let stream = match stream {
            Ok(stream) => stream,
            Err(error) => return Err(format!("accept failed: {error}")),
        };
        let store = Arc::clone(&store);
        let token = token.clone();
        let token_spent = Arc::clone(&token_spent);
        std::thread::spawn(move || {
            if let Err(error) = handle_connection(stream, &store, &token, &token_spent) {
                eprintln!("saber-core serve: connection error: {error}");
            }
        });
    }
    Ok(())
}

fn handle_connection(
    stream: LocalStream,
    store: &Arc<Mutex<EventStore>>,
    token: &str,
    token_spent: &Arc<AtomicBool>,
) -> Result<(), String> {
    // One BufReader owns the stream; responses write through get_mut (the
    // documented sync pattern — reading and writing the same connection
    // without ownership juggling).
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let mut initialized = false;
    loop {
        line.clear();
        let read = reader
            .read_line(&mut line)
            .map_err(|error| format!("read failed: {error}"))?;
        if read == 0 {
            return Ok(()); // peer disconnected; Core state is untouched
        }
        if read > LINE_LIMIT {
            write_line(reader.get_mut(), &error_frame(None, "frame_too_large"))?;
            return Ok(());
        }
        let now = unix_now_ms();
        let request = match saber_core_protocol::decode_request(line.as_bytes(), now) {
            Ok(request) => request,
            Err(error) => {
                write_line(reader.get_mut(), &error_frame(None, error.code()))?;
                continue;
            }
        };
        let request_id = request.context.request_id.clone();
        if !initialized {
            initialized = handshake(reader.get_mut(), &request, token, &token_spent, &store)?;
            continue;
        }
        match request.method {
            ControlMethod::CoreHealth => {
                let store = store.lock().map_err(|_| "store poisoned".to_string())?;
                let runs = store.run_count().map_err(|e| e.to_string())?;
                let events = store.event_count().map_err(|e| e.to_string())?;
                write_line(
                    reader.get_mut(),
                    &result_frame(&request_id, &health_result(runs, events)),
                )?;
            }
            ControlMethod::EventsSubscribe => {
                let after = request
                    .params
                    .get("after_sequence")
                    .and_then(serde_json::Value::as_i64)
                    .unwrap_or(0)
                    .max(0);
                let limit = request
                    .params
                    .get("limit")
                    .and_then(serde_json::Value::as_i64)
                    .unwrap_or(100);
                let store = store.lock().map_err(|_| "store poisoned".to_string())?;
                let (events, next_cursor) = store
                    .replay_events(after, limit)
                    .map_err(|e| e.to_string())?;
                let total = store.event_count().map_err(|e| e.to_string())?;
                write_line(
                    reader.get_mut(),
                    &result_frame(&request_id, &replay_result(&events, next_cursor, total)),
                )?;
            }
            other => {
                let _ = other;
                write_line(
                    reader.get_mut(),
                    &error_frame(Some(&request_id), "method_not_served"),
                )?;
            }
        }
    }
}

fn bootstrap_token() -> Result<String, String> {
    let mut bytes = [0_u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes).map_err(|error| format!("csprng unavailable: {error}"))?;
    let mut token = String::with_capacity(TOKEN_BYTES * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(token, "{byte:02x}");
    }
    Ok(token)
}

fn error_frame(request_id: Option<&str>, code: &str) -> String {
    format!(
        "{{\"jsonrpc\":\"2.0\",\"id\":{},\"error\":{{\"code\":-32000,\"message\":\"{code}\"}}}}\n",
        serde_json::to_string(request_id.unwrap_or("null")).unwrap_or_else(|_| "null".into())
    )
}

fn result_frame(request_id: &str, result: &serde_json::Value) -> String {
    format!(
        "{{\"jsonrpc\":\"2.0\",\"id\":{},\"result\":{}}}\n",
        serde_json::to_string(request_id).unwrap_or_else(|_| "\"\"".into()),
        result
    )
}

fn write_line(writer: &mut LocalStream, frame: &str) -> Result<(), String> {
    writer
        .write_all(frame.as_bytes())
        .map_err(|error| format!("write failed: {error}"))
}

fn health_result(runs: i64, events: i64) -> serde_json::Value {
    serde_json::json!({
        "status": "ready",
        "run_count": runs,
        "event_count": events,
    })
}

fn replay_result(
    events: &[saber_event_store::ReplayedEvent],
    next_cursor: i64,
    total: i64,
) -> serde_json::Value {
    serde_json::json!({
        "events": events,
        "next_cursor": next_cursor,
        "has_more": next_cursor < total,
    })
}

fn unix_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

// The handshake and audit logic mirror serve.rs; duplicated here because
// the stream types differ (UnixStream vs local-socket stream) and the unix
// module is cfg-gated away on Windows builds.

fn initialize_result(request: &saber_core_protocol::ControlRequest) -> serde_json::Value {
    serde_json::json!({
        "protocol_version": PROTOCOL_VERSION,
        "core_build": env!("CARGO_PKG_VERSION"),
        "workspace_id": request.context.workspace_id,
        "capabilities": ["core.health", "events.subscribe"],
    })
}

fn audit_rejection(
    store: &Arc<Mutex<EventStore>>,
    workspace_id: &str,
    reason: &str,
    request: &saber_core_protocol::ControlRequest,
) {
    let actor = request.context.actor_id.clone();
    let Ok(mut store) = store.lock() else {
        return;
    };
    if let Err(error) = store.record_handshake_failure(workspace_id, reason, &actor, unix_now_ms())
    {
        eprintln!("saber-core serve: handshake audit append failed: {error}");
    }
}

fn handshake(
    writer: &mut LocalStream,
    request: &saber_core_protocol::ControlRequest,
    token: &str,
    token_spent: &Arc<AtomicBool>,
    store: &Arc<Mutex<EventStore>>,
) -> Result<bool, String> {
    let request_id = request.context.request_id.clone();
    let workspace = request.context.workspace_id.clone();
    if request.method != ControlMethod::CoreInitialize {
        audit_rejection(store, &workspace, "not_initialize", request);
        write_line(writer, &error_frame(Some(&request_id), "unauthorized"))?;
        return Ok(false);
    }
    if token_spent.load(Ordering::SeqCst)
        || request
            .params
            .get("bootstrap_token")
            .and_then(serde_json::Value::as_str)
            != Some(token)
    {
        // Never echo the token; never accept a second handshake.
        eprintln!("saber-core serve: rejected handshake (invalid or reused token)");
        audit_rejection(store, &workspace, "invalid_or_reused_token", request);
        write_line(writer, &error_frame(Some(&request_id), "unauthorized"))?;
        return Ok(false);
    }
    token_spent.store(true, Ordering::SeqCst);
    write_line(
        writer,
        &result_frame(&request_id, &initialize_result(request)),
    )?;
    Ok(true)
}
