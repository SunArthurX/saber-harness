/**
 * Saber Agent Workbench — built-in extension skeleton (S26-WP04).
 *
 * Native Code-OSS contribution points only: an activity-bar container, a
 * native tree view with a welcome message, two commands and a read-only
 * workbench placeholder document. There is no webview, no Node integration
 * beyond the standard extension host contract, and no Core connection —
 * S27 introduces the real supervision transport. This extension is a
 * projection: it never owns Goal, Task, Run, policy, secret or execution
 * state.
 */
const vscode = require("vscode");

const WORKBENCH_SCHEME = "saber-workbench";
const NOT_CONNECTED = "not-connected";

function activate(context) {
  const tree = vscode.window.createTreeView("saber.goals", {
    treeDataProvider: {
      getTreeItem: (element) => element,
      getChildren: () => [
        new vscode.TreeItem(
          vscode.l10n.t("Not connected to a Saber Core (S26 engineering preview)"),
          vscode.TreeItemCollapsibleState.None,
        ),
      ],
    },
  });

  const provider = {
    provideTextDocumentContent: () =>
      [
        "Saber Studio — Desktop Agent Workbench (engineering preview)",
        "",
        "This placeholder is an honest unconnected state.",
        "Goal / Task / Run / Realm identities are owned by the trusted",
        "Rust Core and are only projected into this workbench.",
        "The Core supervision transport lands in S27.",
        "",
        "Nothing in this view executes commands or reads secrets.",
      ].join("\n"),
  };

  const openWorkbench = vscode.commands.registerCommand("saber.workbench.open", async () => {
    const document = await vscode.workspace.openTextDocument({
      scheme: WORKBENCH_SCHEME,
      language: "markdown",
    });
    await vscode.window.showTextDocument(document, { preview: false });
  });

  const showStatus = vscode.commands.registerCommand("saber.workbench.status", () => {
    vscode.window.showInformationMessage(vscode.l10n.t("Saber Core: not connected (S26 engineering preview)"));
  });

  context.subscriptions.push(
    tree,
    vscode.workspace.registerTextDocumentContentProvider(WORKBENCH_SCHEME, provider),
    openWorkbench,
    showStatus,
  );

  return { status: NOT_CONNECTED };
}

function deactivate() {
  /* nothing to tear down */
}

module.exports = { activate, deactivate };
