import assert from "node:assert/strict";
import { get as httpGet } from "node:http";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { resolveCoreBinary } from "../dist/index.js";
import { executeForUi, parseRunReceipt, splitArgs, startUiServer, uiDictionary } from "../dist/ui.js";

test("splitArgs is quote-aware", () => {
  assert.deepEqual(splitArgs("/bin/sh -c 'echo hello world'"), ["/bin/sh", "-c", "echo hello world"]);
  assert.deepEqual(splitArgs('  a\tb  "c d"  '), ["a", "b", "c d"]);
  assert.deepEqual(splitArgs(""), []);
});

test("joinArgs round-trips splitArgs for the approval flow", async () => {
  const { joinArgs } = await import("../dist/ui.js");
  const original = "/bin/sh -c 'echo studio smoke ok'";
  const argv = splitArgs(original);
  assert.deepEqual(argv, ["/bin/sh", "-c", "echo studio smoke ok"]);
  const rejoined = joinArgs(argv);
  assert.equal(rejoined, original);
  assert.deepEqual(splitArgs(rejoined), argv, "re-quoted command must re-split identically");
  assert.deepEqual(splitArgs(joinArgs(["it's", "a b"])), ["it's", "a b"]);
});

test("parseRunReceipt reads the core's own verdict lines", () => {
  const denied = parseRunReceipt(
    "run run_0001 denied (deny/default_deny): events=2 hash_chain_verified=true\nstore /tmp/facts.db\n",
  );
  assert.equal(denied.runId, "run_0001");
  assert.equal(denied.verdict, "denied");
  assert.equal(denied.denyReason, "deny/default_deny");
  assert.equal(denied.events, 2);
  assert.equal(denied.hashChainVerified, true);
  assert.equal(denied.store, "/tmp/facts.db");

  const executed = parseRunReceipt(
    "run run_0002 executed exit=0: events=7 hash_chain_verified=true\nstore /tmp/facts.db\n",
  );
  assert.equal(executed.verdict, "executed");
  assert.equal(executed.denyReason, null);
  assert.equal(executed.events, 7);

  const garbage = parseRunReceipt("total noise\n");
  assert.equal(garbage.verdict, "unparsed");
  assert.equal(garbage.hashChainVerified, false);
});

test("ui dictionary keeps zh/en parity for every key", () => {
  const dictionary = uiDictionary();
  const keys = Object.keys(dictionary);
  assert.ok(keys.length >= 150, `expected a full studio dictionary, got ${keys.length} keys`);
  for (const key of keys) {
    assert.equal(typeof dictionary[key].zh, "string", `${key}.zh must be a string`);
    assert.equal(typeof dictionary[key].en, "string", `${key}.en must be a string`);
    assert.ok(dictionary[key].zh.length > 0, `${key}.zh must not be empty`);
    assert.ok(dictionary[key].en.length > 0, `${key}.en must not be empty`);
  }
});

test("every state chip the client renders has a dictionary entry", async () => {
  const { createUiPage } = await import("../dist/ui-page.js");
  const html = createUiPage({
    workspace: "w",
    branch: "main",
    store: "/tmp/s",
    core: "/tmp/core",
    platform: "test",
    sandboxBackend: "test://x",
    node: "0",
    version: "0",
    port: 1,
    startedAt: new Date().toISOString(),
  });
  const chipNames = new Set([...html.matchAll(/chip\("([a-z_]+)"\)/g)].map((match) => match[1]));
  assert.ok(chipNames.size >= 5, "expected several state chips in the client script");
  const dictionary = uiDictionary();
  for (const name of chipNames) {
    assert.ok(dictionary[`state.${name}`], `state chip "${name}" must have a state.${name} dictionary entry`);
  }
});

test("ui server serves the studio console and runs the governed core", async () => {
  const core = resolveCoreBinary();
  assert.notEqual(core, null, "saber-core must be built before cli tests");
  const { server, port } = await startUiServer({ core, port: 0, store: "/tmp/saber-ui-test" });
  const close = () => new Promise((resolve) => server.close(resolve));

  try {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes("Saber Studio"), "page must brand as Saber Studio");
    assert.ok(html.includes("--surface-canvas"), "Quiet Armor tokens must be inlined");
    assert.ok(html.includes("--signal-cognition"), "signal tokens must be inlined");
    assert.ok(html.includes('"zh"'), "zh dictionary must be embedded");
    assert.ok(html.includes('"en"'), "en dictionary must be embedded");
    assert.ok(html.includes("切换到 English"), "zh toggle copy must be embedded");

    // The client script is embedded in a template literal; compiling it here
    // catches quote-mismatch syntax errors before a browser ever loads it.
    const inline = html.match(/<script>([\S\s]*)<\/script>/);
    assert.ok(inline !== null, "page must embed exactly one client script");
    assert.doesNotThrow(() => new Function(inline[1]), "client script must compile");

    // Serving optimization: gzip when accepted, 304 on ETag revalidation.
    // Measured over a raw socket because fetch decompresses transparently.
    const etag = page.headers.get("etag");
    assert.ok(etag !== null && etag.length > 0, "page must carry an ETag");
    const wire = await new Promise((resolve, reject) => {
      httpGet({ host: "127.0.0.1", port, path: "/", headers: { "accept-encoding": "gzip" } }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            encoding: response.headers["content-encoding"],
            vary: response.headers.vary,
            etag: response.headers.etag,
            body: Buffer.concat(chunks),
          }),
        );
      }).on("error", reject);
    });
    assert.equal(wire.status, 200);
    assert.equal(wire.encoding, "gzip");
    assert.equal(wire.vary, "accept-encoding");
    assert.equal(wire.etag, etag);
    assert.ok(
      wire.body.length > 0 && wire.body.length < html.length / 2,
      `gzip wire body (${wire.body.length}B) must be far smaller than the raw page (${html.length}B)`,
    );
    assert.equal(gunzipSync(wire.body).toString("utf8"), html, "gzip must decode to the same page");
    const revalidated = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { "if-none-match": etag },
    });
    assert.equal(revalidated.status, 304, "ETag revalidation must return 304");

    const empty = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "   " }),
    });
    assert.equal(empty.status, 400);

    const state = await fetch(`http://127.0.0.1:${port}/api/state`);
    assert.equal(state.status, 200);
    const boot = await state.json();
    assert.equal(boot.ok, true);
    assert.ok(typeof boot.workspace === "string" && boot.workspace.length > 0);
    assert.ok(typeof boot.sandboxBackend === "string" && boot.sandboxBackend.length > 0);

    const denied = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Requesting the core binary itself with arguments, without --allow:
      // the deterministic default-deny policy refuses on every platform
      // (a bare path exits 64 on Windows before policy evaluation).
      body: JSON.stringify({ command: `${core} -c must-not-run`, allow: [], approve: true }),
    });
    const denial = await denied.json();
    assert.equal(denial.exitCode, 2);
    assert.equal(denial.verdict, "denied");
    assert.equal(denial.hashChainVerified, true);
    assert.ok(denial.runId?.startsWith("run_"), "receipts carry core run ids");

    const history = await fetch(`http://127.0.0.1:${port}/api/history`);
    const session = await history.json();
    assert.equal(session.runs.length >= 1, true);
    assert.equal(session.runs[0].verdict, "denied");

    if (process.platform === "darwin") {
      const allowed = await fetch(`http://127.0.0.1:${port}/api/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: "/bin/sh -c 'echo ui-e2e-ok'",
          allow: ["sh"],
          approve: true,
        }),
      });
      const run = await allowed.json();
      assert.equal(run.exitCode, 0, run.stdout);
      assert.equal(run.verdict, "executed");
      assert.ok(run.stdout.includes("ui-e2e-ok"));
    }

    const missing = await fetch(`http://127.0.0.1:${port}/api/nope`);
    assert.equal(missing.status, 404);
  } finally {
    await close();
  }
});

test("executeForUi forwards flags deterministically", () => {
  // A missing core surfaces the spawn failure instead of throwing.
  const result = executeForUi("/nonexistent/saber-core", "/tmp/s", "/bin/true", [], false);
  assert.equal(result.exitCode, null);
  assert.equal(result.verdict, "unparsed");
});
