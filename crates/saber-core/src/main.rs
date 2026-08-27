//! Trusted agent core executable: runs one fully audited sandboxed
//! command through deterministic policy and the encrypted event store.

use std::path::PathBuf;
use std::process::ExitCode;

use saber_core::{RunOptions, RunOutcome, RunReport, execute_run};
use saber_core_protocol::PROTOCOL_VERSION;
use saber_sandbox::BackendRegistry;

/// Creates the deterministic core banner.
#[must_use]
pub fn create_banner() -> String {
    format!("saber-core protocol {PROTOCOL_VERSION}")
}

fn usage() -> String {
    "usage: saber-core run --store <dir> [--workspace <id>] [--task <id>] \
     [--allow <program>]... [--approve] [--stdin <payload>] -- <program> [args...]"
        .to_owned()
}

struct Cli {
    store: PathBuf,
    workspace: String,
    task: String,
    allow: Vec<String>,
    approve: bool,
    stdin: Option<Vec<u8>>,
    argv: Vec<String>,
}

fn parse_cli(args: &[String]) -> Result<Cli, String> {
    let mut cli = Cli {
        store: PathBuf::new(),
        workspace: "ws_local".to_owned(),
        task: "task_local".to_owned(),
        allow: Vec::new(),
        approve: false,
        stdin: None,
        argv: Vec::new(),
    };
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--store" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err("--store requires a directory".to_owned());
                };
                cli.store = PathBuf::from(value);
            }
            "--workspace" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err("--workspace requires an identifier".to_owned());
                };
                cli.workspace.clone_from(value);
            }
            "--task" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err("--task requires an identifier".to_owned());
                };
                cli.task.clone_from(value);
            }
            "--allow" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err("--allow requires a program name".to_owned());
                };
                cli.allow.push(value.clone());
            }
            "--approve" => cli.approve = true,
            "--stdin" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err("--stdin requires a payload".to_owned());
                };
                cli.stdin = Some(value.clone().into_bytes());
            }
            "--" => {
                cli.argv = args[index + 1..].to_vec();
                break;
            }
            other => return Err(format!("unknown argument: {other}")),
        }
        index += 1;
    }
    if cli.store.as_os_str().is_empty() {
        return Err("--store <dir> is required".to_owned());
    }
    if cli.argv.is_empty() {
        return Err("a program is required after --".to_owned());
    }
    Ok(cli)
}

fn render(report: &RunReport) -> String {
    let disposition = match &report.outcome {
        RunOutcome::Executed { exit_code, .. } => format!(
            "executed exit={}",
            exit_code.map_or_else(|| "none".to_owned(), |code| code.to_string())
        ),
        RunOutcome::Denied { outcome, reason } => format!("denied ({outcome}/{reason})"),
        RunOutcome::Failed { reason } => format!("effect failed ({reason})"),
    };
    format!(
        "run {} {}: events={} hash_chain_verified={}",
        report.run_id, disposition, report.events, report.hash_chain_verified
    )
}

fn run(args: &[String]) -> Result<ExitCode, String> {
    let cli = parse_cli(args)?;
    let program = PathBuf::from(&cli.argv[0]);
    let options = RunOptions {
        workspace_id: cli.workspace,
        task_id: cli.task,
        allowed_programs: cli.allow,
        approved: cli.approve,
        stdin: cli.stdin,
        program,
        arguments: cli.argv[1..].to_vec(),
        now_ms: None,
    };
    let mut registry = BackendRegistry::for_current_platform();
    let report =
        execute_run(&cli.store, &mut registry, &options).map_err(|error| error.to_string())?;
    println!("{}", render(&report));
    println!("store {}", report.store_path.display());
    if let RunOutcome::Executed { stdout, .. } = &report.outcome
        && !stdout.is_empty()
    {
        use std::io::Write as _;
        let mut out = std::io::stdout().lock();
        let _ = out.write_all(stdout);
        let _ = out.write_all(b"\n");
    }
    let code = report.exit_code();
    Ok(ExitCode::from(u8::try_from(code.abs()).unwrap_or(1)))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        println!("{}", create_banner());
        println!("{}", usage());
        return ExitCode::SUCCESS;
    }
    match args.first().map(String::as_str) {
        Some("run") => match run(&args[1..]) {
            Ok(code) => code,
            Err(message) => {
                eprintln!("saber-core: {message}");
                eprintln!("{}", usage());
                ExitCode::from(64)
            }
        },
        Some("banner") => {
            println!("{}", create_banner());
            ExitCode::SUCCESS
        }
        Some(other) => {
            eprintln!("saber-core: unknown command {other}");
            eprintln!("{}", usage());
            ExitCode::from(64)
        }
        None => ExitCode::SUCCESS,
    }
}
