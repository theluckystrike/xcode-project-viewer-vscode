'use strict';
// project.pbxproj model: reads the file with the OpenStep parser (src/core/openstep.js, copied unchanged from the Plist
// Viewer & Editor listing), finds the line of every object with src/core/scan.js, and builds what the viewer shows:
// the project, its targets with their build phases, dependencies and Swift package products, the group and file
// tree with each file's path and target membership, Swift packages and build configurations. No VS Code import.
const openstep = require('./openstep');
const { scan } = require('./scan');

class ConflictError extends Error {
  constructor(blocks) {
    super(`This project file has ${blocks.length} git merge conflict${blocks.length === 1 ? '' : 's'} (conflict markers at line${blocks.length === 1 ? '' : 's'} ${blocks.slice(0, 8).map((b) => b.start).join(', ')}${blocks.length > 8 ? ', ...' : ''}). The project view needs a file without conflict markers.`);
    this.blocks = blocks;
    this.conflict = true;
  }
}
class NotProjectError extends Error {}

const START = /^<{7}(?:[ \t]|$)/;
const BASE = /^\|{7}(?:[ \t]|$)/;
const MID = /^={7}\s*$/;
const END = /^>{7}(?:[ \t]|$)/;

/** Git conflict blocks: [{ start, base, mid, end, ours, theirs }] with 1-based line numbers; end 0 when not closed. */
function findConflicts(text) {
  const lines = text.split('\n');
  const out = [];
  let cur = null;
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k].replace(/\r$/, '');
    if (START.test(l)) { cur = { start: k + 1, base: 0, mid: 0, end: 0, ours: l.slice(7).trim(), theirs: '' }; out.push(cur); continue; }
    if (!cur) continue;
    if (BASE.test(l) && !cur.mid) cur.base = k + 1;
    else if (MID.test(l) && !cur.mid) cur.mid = k + 1;
    else if (END.test(l) && cur.mid) { cur.end = k + 1; cur.theirs = l.slice(7).trim(); cur = null; }
  }
  return out;
}

/** OpenStep node -> plain JS: dict -> object, array -> array, everything else -> its text. */
function plain(n) {
  if (!n) return '';
  if (n.t === 'dict') { const o = {}; for (const [k, v] of n.v) o[k] = plain(v); return o; }
  if (n.t === 'array') return n.v.map(plain);
  return String(n.v);
}

const PHASES = {
  PBXSourcesBuildPhase: 'Sources',
  PBXResourcesBuildPhase: 'Resources',
  PBXFrameworksBuildPhase: 'Frameworks',
  PBXHeadersBuildPhase: 'Headers',
  PBXShellScriptBuildPhase: 'Run Script',
  PBXCopyFilesBuildPhase: 'Copy Files',
  PBXRezBuildPhase: 'Build Carbon Resources',
  PBXAppleScriptBuildPhase: 'AppleScript',
};
const PRODUCT_TYPES = {
  'com.apple.product-type.application': 'App',
  'com.apple.product-type.application.watchapp2': 'Watch app',
  'com.apple.product-type.application.watchapp2-container': 'Watch app container',
  'com.apple.product-type.application.messages': 'Messages app',
  'com.apple.product-type.app-extension': 'App extension',
  'com.apple.product-type.app-extension.messages': 'Messages extension',
  'com.apple.product-type.app-extension.messages-sticker-pack': 'Sticker pack',
  'com.apple.product-type.extensionkit-extension': 'ExtensionKit extension',
  'com.apple.product-type.watchkit2-extension': 'WatchKit extension',
  'com.apple.product-type.tv-app-extension': 'TV app extension',
  'com.apple.product-type.framework': 'Framework',
  'com.apple.product-type.framework.static': 'Static framework',
  'com.apple.product-type.library.static': 'Static library',
  'com.apple.product-type.library.dynamic': 'Dynamic library',
  'com.apple.product-type.bundle': 'Bundle',
  'com.apple.product-type.bundle.unit-test': 'Unit tests',
  'com.apple.product-type.bundle.ui-testing': 'UI tests',
  'com.apple.product-type.tool': 'Command line tool',
  'com.apple.product-type.xpc-service': 'XPC service',
  'com.apple.product-type.application.on-demand-install-capable': 'App Clip',
  'com.apple.product-type.system-extension': 'System extension',
  'com.apple.product-type.driver-extension': 'Driver extension',
  'com.apple.product-type.kernel-extension': 'Kernel extension',
  'com.apple.product-type.instruments-package': 'Instruments package',
  'com.apple.product-type.metal-library': 'Metal library',
  'com.apple.product-type.xcode-extension': 'Xcode source editor extension',
};
const GROUP_ISA = new Set(['PBXGroup', 'PBXVariantGroup', 'XCVersionGroup', 'PBXFileSystemSynchronizedRootGroup']);
const FILE_ISA = new Set(['PBXFileReference', 'PBXReferenceProxy']);
// Fields that hold object ids (one id, or a list of ids). remoteGlobalIDString points into another project and is left out.
const REF_ONE = ['fileRef', 'productRef', 'target', 'targetProxy', 'buildConfigurationList', 'mainGroup', 'productRefGroup', 'baseConfigurationReference', 'baseConfigurationReferenceAnchor', 'package', 'productReference', 'remoteRef', 'containerPortal'];
const REF_LIST = ['children', 'files', 'buildPhases', 'targets', 'dependencies', 'buildConfigurations', 'packageReferences', 'packageProductDependencies', 'buildRules', 'fileSystemSynchronizedGroups', 'exceptions', 'localPackages'];
const PATH_CHECKED = new Set(['<group>', 'SOURCE_ROOT', '<absolute>']);

const kindOfFile = (o) => {
  const t = o.lastKnownFileType || o.explicitFileType || '';
  const p = (o.path || o.name || '').toLowerCase();
  if (/swift/.test(t) || p.endsWith('.swift')) return 'swift';
  if (/sourcecode\.(c|cpp)\.h/.test(t) || /\.(h|hpp|hh)$/.test(p)) return 'header';
  if (/sourcecode\.(c|cpp|objc|objcpp|c\.objc|cpp\.objcpp|asm|metal)/.test(t) || /\.(m|mm|c|cc|cpp|cxx|s|metal)$/.test(p)) return 'code';
  if (/xcassets|image|png|jpeg|jpg|pdf$/.test(t) || /\.(xcassets|png|jpe?g|gif|pdf|svg|heic)$/.test(p)) return 'image';
  if (/storyboard|xib|nib/.test(t) || /\.(storyboard|xib)$/.test(p)) return 'ui';
  if (/plist|entitlements/.test(t) || /\.(plist|entitlements|xcprivacy)$/.test(p)) return 'plist';
  if (/xcconfig/.test(t) || p.endsWith('.xcconfig')) return 'config';
  if (/wrapper\.framework|xcframework|archive\.ar|compiled\.mach-o\.dylib|sourcecode\.text-based-dylib/.test(t) || /\.(framework|xcframework|a|dylib|tbd)$/.test(p)) return 'framework';
  if (/wrapper\.(application|app-extension|cfbundle|plug-in|xpc-service|extensionkit-extension)/.test(t) || /\.(app|appex|xctest|bundle)$/.test(p)) return 'product';
  if (/wrapper\.pb-project/.test(t) || p.endsWith('.xcodeproj')) return 'project';
  if (/folder/.test(t)) return 'folder';
  if (/strings|xcstrings|stringsdict/.test(t) || /\.(strings|xcstrings|stringsdict)$/.test(p)) return 'strings';
  if (/net\.daringfireball\.markdown/.test(t) || /\.(md|txt|json|html|css|js)$/.test(p)) return 'text';
  return 'file';
};
const base = (p) => String(p || '').split('/').filter(Boolean).pop() || '';
function joinPath(a, b) {
  if (!b) return a;
  if (b.startsWith('/')) return b;
  if (!a) return b;
  return `${a.replace(/\/+$/, '')}/${b}`;
}
/** Normalizes "a/./b/../c" to "a/c" (keeps a leading "../"). */
function normPath(p) {
  const abs = p.startsWith('/');
  const out = [];
  for (const s of p.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..' && out.length && out[out.length - 1] !== '..') out.pop();
    else out.push(s);
  }
  return (abs ? '/' : '') + out.join('/');
}

function nameOf(objects, id) {
  const o = objects[id];
  if (!o) return '';
  if (o.isa === 'PBXBuildFile') return nameOf(objects, o.fileRef || o.productRef) || id;
  if (o.isa === 'XCSwiftPackageProductDependency') return o.productName || id;
  if (o.isa === 'PBXProject') return 'Project';
  if (o.isa === 'XCBuildConfiguration') return o.name || id;
  if (o.isa === 'XCConfigurationList') return 'Build configuration list';
  if (o.isa === 'XCRemoteSwiftPackageReference') return o.repositoryURL ? base(o.repositoryURL).replace(/\.git$/, '') : id;
  if (o.isa === 'XCLocalSwiftPackageReference') return o.relativePath ? base(o.relativePath) : id;
  if (PHASES[o.isa]) return o.name || PHASES[o.isa];
  if (o.isa === 'PBXTargetDependency') return o.name || nameOf(objects, o.target) || 'Target dependency';
  if (o.isa === 'PBXContainerItemProxy') return o.remoteInfo || 'Item proxy';
  return o.name || base(o.path) || o.productName || id;
}

function requirementText(r) {
  if (!r || typeof r !== 'object') return '';
  switch (r.kind) {
    case 'upToNextMajorVersion': return `from ${r.minimumVersion} (up to next major)`;
    case 'upToNextMinorVersion': return `from ${r.minimumVersion} (up to next minor)`;
    case 'exactVersion': return `exactly ${r.version}`;
    case 'versionRange': return `${r.minimumVersion} to below ${r.maximumVersion}`;
    case 'branch': return `branch ${r.branch}`;
    case 'revision': return `revision ${String(r.revision || '').slice(0, 12)}`;
    default: return Object.entries(r).map(([k, v]) => `${k} ${v}`).join(', ');
  }
}

/** Parses project.pbxproj text. Throws ConflictError (merge markers), NotProjectError, or the parser's line error. */
function load(text, opts = {}) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const conflicts = findConflicts(text);
  if (conflicts.length) throw new ConflictError(conflicts);
  const parsed = openstep.parse(text);
  const root = plain(parsed.root);
  if (!root || typeof root !== 'object' || Array.isArray(root) || !root.objects || typeof root.objects !== 'object' || Array.isArray(root.objects)) {
    throw new NotProjectError('This file is a property list, but not an Xcode project: it has no "objects" dictionary.');
  }
  const objects = root.objects;
  const proj = objects[root.rootObject];
  if (!proj || proj.isa !== 'PBXProject') throw new NotProjectError('This file has no PBXProject object (rootObject). It does not look like an Xcode project file.');
  return build(root, scan(text), text, opts);
}

function build(root, idx, text, opts = {}) {
  const objects = root.objects;
  const ids = Object.keys(objects);
  const projId = root.rootObject;
  const proj = objects[projId];
  const lineOf = (id) => idx.lineOf('objects', id);
  const isaCounts = {};
  for (const id of ids) { const isa = (objects[id] && objects[id].isa) || '(none)'; isaCounts[isa] = (isaCounts[isa] || 0) + 1; }

  // parents of groups and files
  const parent = new Map();
  for (const id of ids) {
    const o = objects[id];
    if (o && GROUP_ISA.has(o.isa) && Array.isArray(o.children)) for (const c of o.children) if (!parent.has(c)) parent.set(c, id);
  }
  // SRCROOT-relative paths
  const srcRoot = normPath(proj.projectDirPath || '');
  const pathCache = new Map();
  function resolve(id, depth = 0) {
    if (pathCache.has(id)) return pathCache.get(id);
    const o = objects[id];
    let r = { base: 'SRCROOT', rel: '' };
    if (!o || depth > 64) return r;
    const tree = o.sourceTree || '<group>';
    if (id === proj.mainGroup) r = { base: 'SRCROOT', rel: normPath(o.path || '') };
    else if (tree === '<group>') {
      const p = parent.has(id) ? resolve(parent.get(id), depth + 1) : { base: 'SRCROOT', rel: '' };
      r = o.path ? (o.path.startsWith('/') ? { base: 'ABS', rel: normPath(o.path) } : { base: p.base, rel: normPath(joinPath(p.rel, o.path)) }) : p;
    } else if (tree === 'SOURCE_ROOT') r = { base: 'SRCROOT', rel: normPath(o.path || '') };
    else if (tree === '<absolute>') r = { base: 'ABS', rel: normPath(o.path || '') };
    else r = { base: tree, rel: normPath(o.path || '') };
    pathCache.set(id, r);
    return r;
  }
  const shownPath = (r) => (r.base === 'SRCROOT' ? r.rel || '.' : r.base === 'ABS' ? r.rel : `$(${r.base})/${r.rel}`);

  // configuration lists
  const configList = (listId) => {
    const l = objects[listId];
    if (!l || !Array.isArray(l.buildConfigurations)) return { id: listId, line: lineOf(listId), defaultName: '', configs: [] };
    return {
      id: listId, line: lineOf(listId), defaultName: l.defaultConfigurationName || '',
      configs: l.buildConfigurations.map((cid) => {
        const c = objects[cid] || {};
        const baseId = c.baseConfigurationReference || '';
        let basePath = '';
        if (baseId && objects[baseId]) basePath = shownPath(resolve(baseId));
        else if (c.baseConfigurationReferenceAnchor && c.baseConfigurationReferenceRelativePath) basePath = shownPath({ ...resolve(c.baseConfigurationReferenceAnchor), rel: normPath(joinPath(resolve(c.baseConfigurationReferenceAnchor).rel, c.baseConfigurationReferenceRelativePath)) });
        const settings = c.buildSettings && typeof c.buildSettings === 'object' ? c.buildSettings : {};
        return { id: cid, name: c.name || cid, line: lineOf(cid), baseId, basePath, settings, count: Object.keys(settings).length };
      }),
    };
  };

  // which targets each file is built in (through build files in their phases)
  const membership = new Map();
  const phaseOf = new Map();
  const targetIds = (Array.isArray(proj.targets) ? proj.targets : []).filter((t) => objects[t]);
  const targets = targetIds.map((tid) => {
    const t = objects[tid];
    const phases = (Array.isArray(t.buildPhases) ? t.buildPhases : []).map((pid) => {
      const ph = objects[pid] || { isa: '(missing)' };
      const files = (Array.isArray(ph.files) ? ph.files : []).map((bid) => {
        const bf = objects[bid];
        phaseOf.set(bid, pid);
        if (!bf) return { buildFile: bid, ref: '', name: bid, missingObject: true, line: 0 };
        const ref = bf.fileRef || bf.productRef || '';
        if (bf.fileRef) { if (!membership.has(bf.fileRef)) membership.set(bf.fileRef, new Set()); membership.get(bf.fileRef).add(t.name || tid); }
        const s = bf.settings && typeof bf.settings === 'object' ? bf.settings : null;
        const ro = objects[ref];
        return {
          buildFile: bid, ref, name: nameOf(objects, ref) || ref, line: lineOf(bid),
          path: ro && FILE_ISA.has(ro.isa) ? shownPath(resolve(ref)) : '',
          kind: ro ? (ro.isa === 'XCSwiftPackageProductDependency' ? 'package' : GROUP_ISA.has(ro.isa) ? 'group' : kindOfFile(ro)) : 'missing',
          attrs: s && Array.isArray(s.ATTRIBUTES) ? s.ATTRIBUTES.join(', ') : '',
          flags: s && s.COMPILER_FLAGS ? s.COMPILER_FLAGS : '',
          missingObject: !ro,
        };
      });
      const out = { id: pid, isa: ph.isa, kind: PHASES[ph.isa] || ph.isa, name: ph.name || PHASES[ph.isa] || ph.isa, line: lineOf(pid), files };
      if (ph.isa === 'PBXShellScriptBuildPhase') {
        out.script = String(ph.shellScript || '');
        out.shell = ph.shellPath || '/bin/sh';
        out.inputs = [].concat(ph.inputPaths || [], ph.inputFileListPaths || []);
        out.outputs = [].concat(ph.outputPaths || [], ph.outputFileListPaths || []);
        out.onlyInstall = ph.runOnlyForDeploymentPostprocessing === '1';
        out.scriptLine = idx.lineOf('objects', pid, 'shellScript');
      }
      if (ph.isa === 'PBXCopyFilesBuildPhase') { out.dstPath = ph.dstPath || ''; out.dstSubfolderSpec = ph.dstSubfolderSpec || ''; }
      return out;
    });
    const deps = (Array.isArray(t.dependencies) ? t.dependencies : []).map((did) => {
      const d = objects[did] || {};
      const proxy = objects[d.targetProxy] || {};
      return { id: did, line: lineOf(did), target: d.target || '', name: d.name || nameOf(objects, d.target) || proxy.remoteInfo || (d.productRef ? nameOf(objects, d.productRef) : '') || did, external: !d.target && !!proxy.remoteInfo, missing: !objects[did] };
    });
    const pkgs = (Array.isArray(t.packageProductDependencies) ? t.packageProductDependencies : []).map((pid) => {
      const p = objects[pid] || {};
      return { id: pid, line: lineOf(pid), product: p.productName || pid, package: p.package ? nameOf(objects, p.package) : '', missing: !objects[pid] };
    });
    const sync = (Array.isArray(t.fileSystemSynchronizedGroups) ? t.fileSystemSynchronizedGroups : []).map((gid) => ({ id: gid, name: nameOf(objects, gid), path: objects[gid] ? shownPath(resolve(gid)) : '', line: lineOf(gid) }));
    for (const g of sync) { if (!membership.has(g.id)) membership.set(g.id, new Set()); membership.get(g.id).add(t.name || tid); }
    return {
      id: tid, isa: t.isa, name: t.name || tid, productName: t.productName || '', productType: t.productType || '',
      typeLabel: PRODUCT_TYPES[t.productType] || (t.isa === 'PBXAggregateTarget' ? 'Aggregate' : t.isa === 'PBXLegacyTarget' ? 'External build' : (t.productType || '').replace(/^com\.apple\.product-type\./, '') || 'Target'),
      product: t.productReference ? nameOf(objects, t.productReference) : '',
      line: lineOf(tid), phases, deps, packages: pkgs, sync,
      configList: configList(t.buildConfigurationList),
      buildTool: t.isa === 'PBXLegacyTarget' ? `${t.buildToolPath || ''} ${t.buildArgumentsString || ''}`.trim() : '',
    };
  });

  // group tree
  let nodeCount = 0;
  const seenTree = new Set();
  function treeNode(id, depth) {
    const o = objects[id];
    nodeCount++;
    if (!o) return { id, name: id, kind: 'missing', missingObject: true, line: 0, children: [] };
    const r = resolve(id);
    const isGroup = GROUP_ISA.has(o.isa);
    const node = {
      id, isa: o.isa, name: nameOf(objects, id), line: lineOf(id),
      kind: o.isa === 'PBXFileSystemSynchronizedRootGroup' ? 'sync' : o.isa === 'PBXVariantGroup' ? 'variant' : o.isa === 'XCVersionGroup' ? 'version' : isGroup ? 'group' : kindOfFile(o),
      path: o.path || '', sourceTree: o.sourceTree || '', full: shownPath(r), base: r.base, rel: r.rel,
      fileType: o.lastKnownFileType || o.explicitFileType || '',
      targets: membership.has(id) ? [...membership.get(id)] : [],
      checkable: PATH_CHECKED.has(o.sourceTree || '<group>') && (!isGroup || !!o.path) && r.base !== 'BUILT_PRODUCTS_DIR',
      children: [],
    };
    if (isGroup && Array.isArray(o.children) && !seenTree.has(id) && depth < 64) {
      seenTree.add(id);
      node.children = o.children.map((c) => treeNode(c, depth + 1));
    }
    return node;
  }
  const tree = proj.mainGroup ? treeNode(proj.mainGroup, 0) : null;
  if (tree) tree.name = tree.name === proj.mainGroup ? 'Project' : tree.name;

  // Swift packages
  const packages = [];
  for (const id of [].concat(proj.packageReferences || [], proj.localPackages || [])) {
    const p = objects[id];
    if (!p) { packages.push({ id, missing: true, name: id, line: 0, products: [] }); continue; }
    packages.push({
      id, isa: p.isa, line: lineOf(id), local: p.isa === 'XCLocalSwiftPackageReference',
      name: nameOf(objects, id), url: p.repositoryURL || '', path: p.relativePath || '',
      requirement: requirementText(p.requirement), products: [],
    });
  }
  for (const id of ids) {
    const o = objects[id];
    if (!o || o.isa !== 'XCSwiftPackageProductDependency') continue;
    const pk = packages.find((p) => p.id === o.package);
    const users = targets.filter((t) => t.packages.some((x) => x.id === id)).map((t) => t.name);
    if (pk) { if (!pk.products.some((x) => x.name === o.productName)) pk.products.push({ name: o.productName || id, targets: users }); else pk.products.find((x) => x.name === o.productName).targets.push(...users); }
  }

  const projectConfigs = configList(proj.buildConfigurationList);
  const attrs = proj.attributes && typeof proj.attributes === 'object' ? proj.attributes : {};
  const facts = [
    ['Project', opts.projectName || ''],
    ['Object version', root.objectVersion || ''],
    ['Archive version', root.archiveVersion || ''],
    ['Compatibility', proj.compatibilityVersion || ''],
    ['Preferred object version', proj.preferredProjectObjectVersion || ''],
    ['Last Swift update', attrs.LastSwiftUpdateCheck || ''],
    ['Last upgrade check', attrs.LastUpgradeCheck || ''],
    ['Organization', attrs.ORGANIZATIONNAME || ''],
    ['Class prefix', attrs.CLASSPREFIX || ''],
    ['Development region', proj.developmentRegion || ''],
    ['Known regions', Array.isArray(proj.knownRegions) ? proj.knownRegions.join(', ') : ''],
    ['Project directory', proj.projectDirPath || ''],
    ['Objects', ids.length.toLocaleString('en-US')],
  ].filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => ({ k, v: String(v) }));

  const files = ids.filter((id) => objects[id] && FILE_ISA.has(objects[id].isa));
  return {
    root, objects, idx, text, projId, project: proj, srcRoot,
    objectVersion: root.objectVersion || '', objectCount: ids.length, isaCounts, facts,
    targets, tree, packages, projectConfigs, membership, parent, phaseOf,
    fileCount: files.length, groupCount: ids.filter((id) => objects[id] && GROUP_ISA.has(objects[id].isa)).length, nodeCount,
    resolve, shownPath, nameOf: (id) => nameOf(objects, id), lineOf,
    configNames: [...new Set([].concat(projectConfigs.configs.map((c) => c.name), ...targets.map((t) => t.configList.configs.map((c) => c.name))))],
  };
}

/** Every reference from one object to another, with the field and the line (for the broken reference checks). */
function references(m) {
  const out = [];
  const { objects, idx } = m;
  for (const id of Object.keys(objects)) {
    const o = objects[id];
    if (!o || typeof o !== 'object') continue;
    for (const f of REF_ONE) {
      if (typeof o[f] !== 'string' || !o[f]) continue;
      if (f === 'containerPortal' && o[f] === m.projId) continue;
      out.push({ from: id, field: f, to: o[f], line: idx.lineOf('objects', id, f) || idx.lineOf('objects', id), list: false });
    }
    for (const f of REF_LIST) {
      if (!Array.isArray(o[f])) continue;
      const lines = idx.itemsOf('objects', id, f);
      o[f].forEach((to, k) => { if (typeof to === 'string') out.push({ from: id, field: f, to, line: (lines[k] && lines[k].line) || idx.lineOf('objects', id, f), list: true, index: k }); });
    }
    if (o.isa === 'PBXProject' && Array.isArray(o.projectReferences)) {
      for (const pr of o.projectReferences) for (const f of ['ProductGroup', 'ProjectRef']) if (pr && typeof pr[f] === 'string') out.push({ from: id, field: `projectReferences.${f}`, to: pr[f], line: idx.lineOf('objects', id, 'projectReferences'), list: false });
    }
  }
  return out;
}

module.exports = { load, build, findConflicts, plain, references, nameOf, normPath, joinPath, requirementText, ConflictError, NotProjectError, PHASES, PRODUCT_TYPES, GROUP_ISA, FILE_ISA, REF_ONE, REF_LIST };
