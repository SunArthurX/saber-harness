//! S27 supervision transport: a local, read-only Core endpoint.
//!
//! `serve` listens on the workspace's contracted local endpoint, proves the
//! one-time bootstrap token before anything else, and answers exactly the
//! lifecycle surface the desktop needs today — `core.initialize`,
//! `core.health` and cursor-ordered `events.subscribe` replay. It executes
//! nothing: there is no effect path here, and run-mutation methods fail
//! closed. Windows named-pipe serving fails closed until its dedicated
//! landing; no half-transport is ever exposed.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::{FileTypeExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use saber_core_protocol::{ControlMethod, DesktopPlatform, MAX_FRAME_BYTES, PROTOCOL_VERSION};
use saber_event_store::EventStore;

use crate::KeyFileProvider;

/// Hard cap on one line frame including the newline.
const LINE_LIMIT: usize = MAX_FRAME_BYTES + 1;
const TOKEN_BYTES: usize = 32;

/// Serve the workspace supervision endpoint until the process is stopped.
///
/// # Errors
///
/// Fails with a human-readable reason when the platform transport is
/// unavailable, the endpoint is unsafe to bind, the store cannot open or a
/// connection loop fails unrecoverably.
pub fn serve(store_dir: &Path, workspace_id: &str) -> Result<(), String> {
    if !cfg!(unix) {
        return Err("windows named-pipe transport is not implemented; refusing to serve".into());
    }
    let address = saber_core_protocol::transport_address(DesktopPlatform::Unix, workspace_id)
        .map_err(|error| error.to_string())?;
    let listener = bind_hardened(&address)?;

    std::fs::create_dir_all(store_dir).map_err(|_| "store directory unavailable".to_string())?;
    let provider = KeyFileProvider::new(store_dir);
    let store = EventStore::open(&store_dir.join("facts.db"), workspace_id, &provider)
        .map_err(|error| format!("store open failed: {error}"))?;
    // The endpoint is read-only (health + replay), so one shared store
    // behind a mutex serializes concurrent desktop connections safely.
    let store = Arc::new(Mutex::new(store));

    let token = bootstrap_token()?;
    // The one and only channel the token ever travels: stdout of the
    // spawned process, captured by the desktop main process. Never argv,
    // never the environment, never a log line afterwards.
    println!("bootstrap-token {token}");
    std::io::stdout()
        .flush()
        .map_err(|error| error.to_string())?;
    println!("serving {address} workspace {workspace_id}");
    std::io::stdout()
        .flush()
        .map_err(|error| error.to_string())?;

    // One thread per connection: the desktop keeps several long-lived
    // connections open at once (main bridge, renderer bridge, tooling),
    // so a serial accept loop would starve every peer after the first.
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

/// Bind the endpoint with local hardening: reject symlinks, refuse when a
/// live server already owns the socket, reap only provably stale sockets,
/// and force mode 0600.
fn bind_hardened(address: &str) -> Result<UnixListener, String> {
    let path = PathBuf::from(address);
    if let Ok(metadata) = std::fs::symlink_metadata(&path) {
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            return Err(format!("refusing endpoint {address}: symlink"));
        }
        if !file_type.is_socket() {
            return Err(format!("refusing endpoint {address}: not a socket"));
        }
        if UnixStream::connect(&path).is_ok() {
            return Err(format!(
                "refusing endpoint {address}: a Core is already serving it"
            ));
        }
        std::fs::remove_file(&path)
            .map_err(|error| format!("stale socket removal failed: {error}"))?;
    }
    let listener = UnixListener::bind(&path).map_err(|error| format!("bind failed: {error}"))?;
    // Mode 0600 on the socket file itself (the listener has no permission
    // API; the on-disk endpoint is what peers see).
    let permissions = std::fs::Permissions::from_mode(0o600);
    std::fs::set_permissions(&path, permissions)
        .map_err(|error| format!("socket permission hardening failed: {error}"))?;
    Ok(listener)
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

fn initialize_result(request: &saber_core_protocol::ControlRequest) -> serde_json::Value {
    serde_json::json!({
        "protocol_version": PROTOCOL_VERSION,
        "core_build": env!("CARGO_PKG_VERSION"),
        "workspace_id": request.context.workspace_id,
        "capabilities": ["core.health", "events.subscribe"],
    })
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

fn handshake(
    writer: &mut UnixStream,
    request: &saber_core_protocol::ControlRequest,
    token: &str,
    token_spent: &AtomicBool,
) -> Result<bool, String> {
    let request_id = request.context.request_id.clone();
    if request.method != ControlMethod::CoreInitialize {
        write_frame(writer, &error_frame(Some(&request_id), "unauthorized"))?;
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
        write_frame(writer, &error_frame(Some(&request_id), "unauthorized"))?;
        return Ok(false);
    }
    token_spent.store(true, Ordering::SeqCst);
    write_frame(
        writer,
        &result_frame(&request_id, &initialize_result(request)),
    )?;
    Ok(true)
}

fn handle_connection(
    stream: UnixStream,
    store: &Arc<Mutex<EventStore>>,
    token: &str,
    token_spent: &Arc<AtomicBool>,
) -> Result<(), String> {
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut writer = stream;
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
            write_frame(&mut writer, &error_frame(None, "frame_too_large"))?;
            return Ok(());
        }
        let now = unix_now_ms();
        let request = match saber_core_protocol::decode_request(line.as_bytes(), now) {
            Ok(request) => request,
            Err(error) => {
                write_frame(&mut writer, &error_frame(None, error.code()))?;
                continue;
            }
        };
        let request_id = request.context.request_id.clone();
        if !initialized {
            initialized = handshake(&mut writer, &request, token, token_spent)?;
            continue;
        }
        match request.method {
            ControlMethod::CoreHealth => {
                let store = store.lock().map_err(|_| "store poisoned".to_string())?;
                let runs = store.run_count().map_err(|e| e.to_string())?;
                let events = store.event_count().map_err(|e| e.to_string())?;
                write_frame(
                    &mut writer,
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
                write_frame(
                    &mut writer,
                    &result_frame(&request_id, &replay_result(&events, next_cursor, total)),
                )?;
            }
            other => {
                let _ = other;
                write_frame(
                    &mut writer,
                    &error_frame(Some(&request_id), "method_not_served"),
                )?;
            }
        }
    }
}

fn write_frame(writer: &mut UnixStream, frame: &str) -> Result<(), String> {
    writer
        .write_all(frame.as_bytes())
        .map_err(|error| format!("write failed: {error}"))
}

fn unix_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn unique_endpoint(label: &str) -> String {
        format!("/tmp/saber-test-{label}-{}.sock", std::process::id())
    }

    #[test]
    fn fresh_bind_forces_socket_mode_0600() {
        let address = unique_endpoint("fresh");
        std::fs::remove_file(&address).ok();
        let listener = bind_hardened(&address).ok();
        assert!(listener.is_some(), "bind must succeed on a free endpoint");
        let mode = std::fs::metadata(&address).map_or(0, |metadata| metadata.permissions().mode());
        assert_eq!(mode & 0o777, 0o600);
        drop(listener);
        std::fs::remove_file(&address).ok();
    }

    #[test]
    fn symlinked_endpoint_is_refused() {
        let target = unique_endpoint("target");
        let link = unique_endpoint("link");
        std::fs::remove_file(&target).ok();
        std::fs::remove_file(&link).ok();
        assert!(std::fs::write(&target, b"x").is_ok());
        assert!(std::os::unix::fs::symlink(&target, &link).is_ok());
        match bind_hardened(&link) {
            Err(error) => assert!(error.contains("symlink"), "unexpected error: {error}"),
            Ok(listener) => {
                drop(listener);
                unreachable!("symlinked endpoint must be refused");
            }
        }
        std::fs::remove_file(&target).ok();
        std::fs::remove_file(&link).ok();
    }

    #[test]
    fn live_endpoint_is_never_stolen_and_stale_endpoint_is_reaped() {
        let address = unique_endpoint("live");
        std::fs::remove_file(&address).ok();
        let live = bind_hardened(&address).ok();
        assert!(live.is_some(), "first bind must succeed");
        match bind_hardened(&address) {
            Err(error) => assert!(
                error.contains("already serving"),
                "unexpected error: {error}"
            ),
            Ok(listener) => {
                drop(listener);
                unreachable!("a live endpoint must never be stolen");
            }
        }
        drop(live);
        // A closed server leaves a stale socket: connectable check fails,
        // so a fresh bind must reap it and succeed.
        let replacement = bind_hardened(&address).ok();
        assert!(replacement.is_some(), "stale socket must be reaped");
        drop(replacement);
        std::fs::remove_file(&address).ok();
    }
}
