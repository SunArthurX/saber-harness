# Desktop Code-OSS product shell

This directory is the home of Saber Studio Desktop, the primary product
surface selected by ADR-028. The application must open the complete Desktop
Agent Workbench by default; the loopback Web supervisor is an optional
companion and is not an implementation substitute.

Current truth: the production Code-OSS/Electron shell has not landed yet. This
directory remains a placeholder at S25. S26 begins the reproducible Code-OSS
bootstrap described in
`docs/execution/DESKTOP-WORKBENCH-ENTERPRISE-PLAN.md`.

The shell must call the separately supervised Rust Core only through the
generated versioned local control protocol. The Electron main process,
renderers, webviews and extension hosts do not own policy, secrets, execution,
audit, recovery or update authority.
