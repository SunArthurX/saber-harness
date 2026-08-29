# Desktop Code-OSS product shell

This directory is the home of Saber Studio Desktop, the primary product
surface selected by ADR-028. The application must open the complete Desktop
Agent Workbench by default; the loopback Web supervisor is an optional
companion and is not an implementation substitute.

Current truth: the desktop plan (S00-S38) is complete. The reproducible
bootstrap is proven end to end on darwin-arm64: pinned upstream,
atomic digest-verified cache, reversible patch series, built-in
`saber-agent` extension, static smoke, full Electron compile (0 errors)
and the runtime dev launch — bounded launch smoke plus persistent
workbench launches over a fixture workspace (recorded as S38
post-plan evidence in `docs/execution/EVIDENCE.json`). Not yet
claimed: three-platform packaged installers and launch smoke on
Windows/Linux — those remain hosted release-pipeline evidence. See
`UPSTREAM-AND-SUPPLY-CHAIN.md` for the supply-chain record.

S26 commands (from the repository root):

```sh
pnpm desktop:upstream:fetch            # download + digest-verify the pinned archive
pnpm desktop:upstream:verify --offline # re-verify the cache with zero network
node apps/desktop-codeoss/scripts/apply-patches.mjs   # extract, patch, copy extension
node apps/desktop-codeoss/scripts/smoke.mjs           # deterministic static smoke
node apps/desktop-codeoss/scripts/build.mjs           # toolchain preflight (fails closed)
```

The shell must call the separately supervised Rust Core only through the
generated versioned local control protocol. The Electron main process,
renderers, webviews and extension hosts do not own policy, secrets,
execution, audit, recovery or update authority. The built-in extension is a
projection and connects to nothing in S26 (engineering preview, RT-0).
