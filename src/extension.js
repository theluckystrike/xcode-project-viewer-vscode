'use strict';
// Xcode Project Viewer (pbxproj) by Zovo: opens project.pbxproj as a project view (targets, build phases, files and
// groups, build settings with inherited values, Swift packages, broken references) on request: the editor title
// button, the Explorer menu, the Command Palette or Open With. The text editor stays the default for the file.
// No network, no telemetry. Activation shows nothing: no message, no popup. The viewer opens only for files the user
// opens, and it never reopens a tab in another editor by itself.
const vscode = require('vscode');
const { PbxEditorProvider, VIEW, PBX_RE } = require('./editor');
const { createTools } = require('./tools');
const { createPro } = require('./pro');
const { createRatingPrompt } = require('./rate');
const support = require('./support');
const { createReach } = require('./reach');
const reachConfig = require('./reach-config');

const PREFIX = 'xcodeProj';
const EXT_ID = 'zovo.zovo-xcode-project-viewer';
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);

function activate(context) {
  const sub = (d) => context.subscriptions.push(d);
  let rating = { success() {}, failure() {} };
  try { rating = createRatingPrompt({ vscode, context, extensionId: EXT_ID, section: PREFIX, name: 'Xcode Project Viewer' }); } catch (e) { /* rating is optional */ }
  support.registerSupport({ vscode, context, prefix: PREFIX, selfId: EXT_ID });
  const pro = createPro({ vscode, context });
  const reach = createReach({ vscode, ...reachConfig, maximum: pro.TRIAL_USES, context, licensed: () => !!pro.licensed, shown: () => setting('showProTools', true) !== false });
  reach.registerCtx();
  sub(pro.onDidChange(() => reach.refresh()));

  const toolCommands = { merge: `${PREFIX}.mergeHelper`, compare: `${PREFIX}.compare`, settings: `${PREFIX}.buildSettings` };
  const provider = new PbxEditorProvider(context, {
    reach: () => reach,
    onSuccess: (doc) => rating.success(doc.uri),
    onFailure: () => rating.failure(),
    runTool: (tool, uri) => (toolCommands[tool] ? vscode.commands.executeCommand(toolCommands[tool], uri) : undefined),
  });
  const opts = { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true };
  sub(vscode.window.registerCustomEditorProvider(VIEW, provider, opts));
  sub(provider);
  const tools = createTools({ context, provider, pro, reach });

  const reg = (id, fn) => sub(vscode.commands.registerCommand(id, async (...a) => {
    try { return await fn(...a); } catch (e) { vscode.window.showErrorMessage(String((e && e.message) || e)); return undefined; }
  }));
  // a clicked .xcodeproj folder means its project.pbxproj
  const target = (uri) => (uri && uri.scheme ? (/\.xcodeproj\/?$/i.test(uri.path) ? vscode.Uri.joinPath(uri, 'project.pbxproj') : uri) : undefined);
  const extraOf = (x) => (x && typeof x === 'object' && !x.scheme && !Array.isArray(x) ? x : {});
  reg(`${PREFIX}.openWithViewer`, async (uri) => {
    let u = uri && uri.scheme ? uri : (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
    if (u && /\.xcodeproj$/i.test(u.path)) u = vscode.Uri.joinPath(u, 'project.pbxproj');
    if (!u || !PBX_RE.test(u.path)) {
      const found = await vscode.workspace.findFiles('**/*.xcodeproj/project.pbxproj', '**/{node_modules,Pods,Carthage,.build}/**', 50).catch(() => []);
      if (!found.length) { vscode.window.showInformationMessage('Open a project.pbxproj file (inside a .xcodeproj folder) first.'); return undefined; }
      if (found.length === 1) u = found[0];
      else {
        const pick = await vscode.window.showQuickPick(found.map((f) => ({ label: f.path.split('/').slice(-2, -1)[0], description: vscode.workspace.asRelativePath ? vscode.workspace.asRelativePath(f) : f.fsPath, uri: f })), { ignoreFocusOut: true, placeHolder: 'The Xcode project to open' });
        if (!pick) return undefined;
        u = pick.uri;
      }
    }
    return vscode.commands.executeCommand('vscode.openWith', u, VIEW);
  });
  reg(`${PREFIX}.openAsText`, (uri) => {
    const u = uri && uri.scheme ? uri : (provider.front() || provider.active || {}).uri;
    if (!u) return undefined;
    return vscode.commands.executeCommand('vscode.openWith', u, 'default');
  });
  reg(`${PREFIX}.openSample`, () => vscode.commands.executeCommand('vscode.openWith', vscode.Uri.joinPath(context.extensionUri, 'samples', 'ZovoDemo.xcodeproj', 'project.pbxproj'), VIEW));
  reg(`${PREFIX}.openWalkthrough`, () => vscode.commands.executeCommand('workbench.action.openWalkthrough', `${EXT_ID}#${PREFIX}.start`, false));
  reg(`${PREFIX}.mergeHelper`, reach.wrap((uri, extra) => tools.merge(target(uri), extraOf(extra))));
  reg(`${PREFIX}.compare`, reach.wrap((uri, extra) => tools.compare(target(uri), extraOf(extra))));
  reg(`${PREFIX}.buildSettings`, reach.wrap((uri, extra) => tools.buildSettings(target(uri), extraOf(extra))));
  sub(vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration(`${PREFIX}.showProTools`)) reach.refresh(); }));
  sub(vscode.window.registerUriHandler({ handleUri: (uri) => pro.handleUri(uri) }));
  return { provider, tools, pro };
}

function deactivate() {}

module.exports = { activate, deactivate };
