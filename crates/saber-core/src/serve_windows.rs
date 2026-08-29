//! S27 Windows named-pipe supervision transport.
//!
//! Mirrors the unix endpoint (serve.rs) over the contracted
//! `\\.\pipe\saber-<workspace>` endpoint: the pipe is created with
//! FILE_FLAG_FIRST_PIPE_INSTANCE so an existing listener can never be
//! silently replaced, PIPE_REJECT_REMOTE_CLIENTS blocks remote access, and
//! the default per-user DACL of the creating process restricts access to
//! the current logon identity. The one-time bootstrap token and the
//! lifecycle method set behave exactly like the unix side.

use std::io::Write;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use saber_core_protocol::{
    ControlMethod, DesktopPlatform, MAX_FRAME_BYTES, PROTOCOL_VERSION, ProtocolError,
};
use saber_event_store::EventStore;

use crate::KeyFileProvider;
use saber_event_store::DatabaseKeyProvider;

const LINE_LIMIT: usize = MAX_FRAME_BYTES + 1;
const TOKEN_BYTES: usize = 32;
const OUT_BUFFER: u32 = 64 * 1024;
const IN_BUFFER: u32 = 64 * 1024;

use std::os::windows::io::FromRawHandle;

use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_MESSAGE,
    PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_MESSAGE, PIPE_UNLIMITED_INSTANCES,
};
// Stable WinSDK constants spelled locally to avoid feature-path churn in
// windows-sys: duplex access (3) and first-instance guard (0x0008_0000).
const PIPE_ACCESS_DUPLEX: u32 = 3;
const FILE_FLAG_FIRST_PIPE_INSTANCE: u32 = 0x0008_0000;

/// Serve the workspace supervision endpoint until the process is stopped.
///
/// # Errors
///
/// Fails with a human-readable reason when the pipe cannot be created, the
/// store cannot open or a connection loop fails unrecoverably.
pub fn serve(store_dir: &Path, workspace_id: &str) -> Result<(), String> {
    let address = saber_core_protocol::transport_address(DesktopPlatform::Windows, workspace_id)
        .map_err(|error| error.to_string())?;

    std::fs::create_dir_all(store_dir).map_err(|_| "store directory unavailable".to_string())?;
    let provider = KeyFileProvider::new(store_dir);
    let store = EventStore::open(&store_dir.join("facts.db"), workspace_id, &provider)
        .map_err(|error| format!("store open failed: {error}"))?;
    let store = Arc::new(Mutex::new(store));

    let token = bootstrap_token()?;
    println!("bootstrap-token {token}");
    std::io::stdout()
        .flush()
        .map_err(|error| error.to_string())?;
    println!("serving {address} workspace {workspace_id}");
    std::io::stdout()
        .flush()
        .map_err(|error| error.to_string())?;

    let token_spent = Arc::new(AtomicBool::new(false));
    loop {
        let pipe = create_pipe_instance(&address)?;
        // Wrap the raw handle before moving into the handler thread so the
        // spawn closure only carries Send types.
        let stream = PipeStream {
            file: unsafe { std::fs::File::from_raw_handle(pipe) },
            handle: pipe,
        };
        let store = Arc::clone(&store);
        let token = token.clone();
        let token_spent = Arc::clone(&token_spent);
        std::thread::spawn(move || {
            if let Err(error) = handle_instance(stream, store, &token, token_spent) {
                eprintln!("saber-core serve: connection error: {error}");
            }
        });
    }
}

fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn create_pipe_instance(address: &str) -> Result<*mut core::ffi::c_void, String> {
    let wide = to_wide(address);
    // The default DACL of the creating process token restricts the pipe to
    // the current logon identity; PIPE_REJECT_REMOTE_CLIENTS blocks remote
    // pipe access. FIRST_PIPE_INSTANCE guarantees an existing listener is
    // never silently replaced.
    let pipe = unsafe {
        CreateNamedPipeW(
            wide.as_ptr(),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_REJECT_REMOTE_CLIENTS,
            PIPE_UNLIMITED_INSTANCES,
            OUT_BUFFER,
            IN_BUFFER,
            0,
            std::ptr::null(),
        )
    };
    if pipe == INVALID_HANDLE_VALUE {
        return Err(format!("pipe creation failed for {address}"));
    }
    Ok(pipe)
}

/// Owns one connected pipe instance: a std File view over the raw handle
/// plus the raw handle retained for DisconnectNamedPipe on drop.
struct PipeStream {
    file: std::fs::File,
    handle: *mut core::ffi::c_void,
}

// The handle is only touched on the owning thread after creation; the
// stream moves once from the accept loop into its handler thread.
unsafe impl Send for PipeStream {}

impl Drop for PipeStream {
    fn drop(&mut self) {
        unsafe {
            DisconnectNamedPipe(self.handle);
            CloseHandle(self.handle);
        }
    }
}

impl Write for PipeStream {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        self.file.write(buffer)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.file.flush()
    }
}

fn handle_instance(
    mut stream: PipeStream,
    store: Arc<Mutex<EventStore>>,
    token: &str,
    token_spent: Arc<AtomicBool>,
) -> Result<(), String> {
    let connected = unsafe { ConnectNamedPipe(stream.handle, std::ptr::null_mut()) };
    if connected == 0 {
        // ERROR_PIPE_CONNECTED (a client connected between creation and
        // ConnectNamedPipe) still yields a usable instance.
        let error = unsafe { windows_sys::Win32::Foundation::GetLastError() };
        const ERROR_PIPE_CONNECTED: u32 = 535;
        if error != ERROR_PIPE_CONNECTED {
            return Err(format!("connect failed: {error}"));
        }
    }
    let mut line = String::new();
    let mut initialized = false;
    loop {
        line.clear();
        // Message-mode pipe: each read returns one write from the peer.
        use std::io::Read as _;
        let mut buffer = vec![0_u8; MAX_FRAME_BYTES + 1];
        let read = stream
            .file
            .read(&mut buffer)
            .map_err(|error| format!("read failed: {error}"))?;
        if read == 0 {
            return Ok(()); // peer disconnected; Core state untouched
        }
        if read > LINE_LIMIT {
            write_line(&mut stream, &error_frame(None, "frame_too_large"))?;
            return Ok(());
        }
        buffer.truncate(read);
        line.push_str(&String::from_utf8_lossy(&buffer));
        let now = unix_now_ms();
        let request = match saber_core_protocol::decode_request(line.as_bytes(), now) {
            Ok(request) => request,
            Err(error) => {
                write_line(&mut stream, &error_frame(None, error.code()))?;
                continue;
            }
        };
        let request_id = request.context.request_id.clone();
        if !initialized {
            initialized = handshake(&mut stream, &request, token, &token_spent, &store)?;
            continue;
        }
        dispatch(
            &mut stream,
            &request_id,
            &request.method,
            &request.params,
            &store,
        )?;
    }
}

fn dispatch(
    stream: &mut PipeStream,
    request_id: &str,
    method: &ControlMethod,
    params: &serde_json::Value,
    store: &Arc<Mutex<EventStore>>,
) -> Result<(), String> {
    match method {
        ControlMethod::CoreHealth => {
            let store = store.lock().map_err(|_| "store poisoned".to_string())?;
            let runs = store.run_count().map_err(|e| e.to_string())?;
            let events = store.event_count().map_err(|e| e.to_string())?;
            write_line(
                stream,
                &result_frame(request_id, &health_result(runs, events)),
            )
        }
        ControlMethod::EventsSubscribe => {
            let after = params
                .get("after_sequence")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(0)
                .max(0);
            let limit = params
                .get("limit")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(100);
            let store = store.lock().map_err(|_| "store poisoned".to_string())?;
            let (events, next_cursor) = store
                .replay_events(after, limit)
                .map_err(|e| e.to_string())?;
            let total = store.event_count().map_err(|e| e.to_string())?;
            write_line(
                stream,
                &result_frame(request_id, &replay_result(&events, next_cursor, total)),
            )
        }
        other => {
            let _ = other;
            write_line(stream, &error_frame(Some(request_id), "method_not_served"))
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

fn write_line(stream: &mut PipeStream, frame: &str) -> Result<(), String> {
    stream
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
// the stream types differ (UnixStream vs named-pipe handle) and the unix
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
    stream: &mut PipeStream,
    request: &saber_core_protocol::ControlRequest,
    token: &str,
    token_spent: &std::sync::atomic::AtomicBool,
    store: &Arc<Mutex<EventStore>>,
) -> Result<bool, String> {
    use std::sync::atomic::Ordering;
    let request_id = request.context.request_id.clone();
    let workspace = request.context.workspace_id.clone();
    if request.method != ControlMethod::CoreInitialize {
        audit_rejection(store, &workspace, "not_initialize", request);
        write_line(stream, &error_frame(Some(&request_id), "unauthorized"))?;
        return Ok(false);
    }
    if token_spent.load(Ordering::SeqCst)
        || request
            .params
            .get("bootstrap_token")
            .and_then(serde_json::Value::as_str)
            != Some(token)
    {
        eprintln!("saber-core serve: rejected handshake (invalid or reused token)");
        audit_rejection(store, &workspace, "invalid_or_reused_token", request);
        write_line(stream, &error_frame(Some(&request_id), "unauthorized"))?;
        return Ok(false);
    }
    token_spent.store(true, Ordering::SeqCst);
    write_line(
        stream,
        &result_frame(&request_id, &initialize_result(request)),
    )?;
    Ok(true)
}
