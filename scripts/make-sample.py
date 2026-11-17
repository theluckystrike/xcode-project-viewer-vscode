#!/usr/bin/env python3
"""Writes samples/ZovoDemo.xcodeproj/project.pbxproj and the small source tree next to it (our own demo project,
MIT). Xcode's text layout: sections sorted by id, /* name */ comments after ids, tabs. One file (Legacy/OldHelper.swift)
is in the project but not on disk on purpose, so the Warnings tab has something to show."""
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'samples')
n = [0]


def nid():
    n[0] += 1
    return 'A0D0E000%016X' % n[0]


O = {}  # id -> (isa, comment, fields list of (key, value)) ; value: str, list of (id, comment) or raw


def obj(isa, comment, fields, oid=None):
    oid = oid or nid()
    O[oid] = (isa, comment, fields)
    return oid


def q(s):
    import re
    return s if re.fullmatch(r'[A-Za-z0-9_$/:.\-]+', s) else '"' + s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'


files = {}


def fref(path, ftype, name=None, tree='<group>'):
    f = [('isa', 'PBXFileReference'), ('lastKnownFileType', ftype), ('path', path), ('sourceTree', tree)]
    if name:
        f.insert(2, ('name', name))
    oid = obj('PBXFileReference', name or os.path.basename(path), f)
    files[oid] = name or os.path.basename(path)
    return oid


def pref(path, ftype):
    f = [('isa', 'PBXFileReference'), ('explicitFileType', ftype), ('includeInIndex', '0'), ('path', path), ('sourceTree', 'BUILT_PRODUCTS_DIR')]
    oid = obj('PBXFileReference', path, f)
    files[oid] = path
    return oid


def bfile(ref, phase, settings=None):
    f = [('isa', 'PBXBuildFile'), ('fileRef', (ref, files[ref]))]
    if settings:
        f.append(('settings', settings))
    return obj('PBXBuildFile', '%s in %s' % (files[ref], phase), f)


# files
app_swift = fref('ZovoDemoApp.swift', 'sourcecode.swift')
content = fref('ContentView.swift', 'sourcecode.swift')
model = fref('TripStore.swift', 'sourcecode.swift')
assets = fref('Assets.xcassets', 'folder.assetcatalog')
info = fref('Info.plist', 'text.plist.xml')
ent = fref('ZovoDemo.entitlements', 'text.plist.entitlements')
old = fref('OldHelper.swift', 'sourcecode.swift')
widget = fref('TripWidget.swift', 'sourcecode.swift')
winfo = fref('Info.plist', 'text.plist.xml')
tests = fref('TripStoreTests.swift', 'sourcecode.swift')
base_cfg = fref('Base.xcconfig', 'text.xcconfig')
release_cfg = fref('Release.xcconfig', 'text.xcconfig')
widgetkit = fref('WidgetKit.framework', 'wrapper.framework', 'WidgetKit.framework', 'SDKROOT')
O[widgetkit][2][3] = ('path', 'System/Library/Frameworks/WidgetKit.framework')
app_p = pref('ZovoDemo.app', 'wrapper.application')
wid_p = pref('ZovoDemoWidget.appex', '"wrapper.app-extension"')
tst_p = pref('ZovoDemoTests.xctest', 'wrapper.cfbundle')

# groups
def group(name_or_path, children, is_path=True):
    f = [('isa', 'PBXGroup'), ('children', [(c, gname(c)) for c in children])]
    f.append(('path' if is_path else 'name', name_or_path))
    f.append(('sourceTree', '<group>'))
    oid = obj('PBXGroup', name_or_path, f)
    files[oid] = name_or_path
    return oid


def gname(c):
    return files.get(c, c)


legacy = group('Legacy', [old], is_path=False)
app_g = group('ZovoDemo', [app_swift, content, model, assets, info, ent, legacy])
wid_g = group('ZovoDemoWidget', [widget, winfo])
tst_g = group('ZovoDemoTests', [tests])
cfg_g = group('Config', [base_cfg, release_cfg])
fw_g = group('Frameworks', [widgetkit], is_path=False)
prod_g = group('Products', [app_p, wid_p, tst_p], is_path=False)
main_f = [('isa', 'PBXGroup'), ('children', [(c, gname(c)) for c in [app_g, wid_g, tst_g, cfg_g, fw_g, prod_g]]), ('sourceTree', '<group>')]
main_g = obj('PBXGroup', None, main_f)

# packages
pkg = obj('XCRemoteSwiftPackageReference', 'XCRemoteSwiftPackageReference "swift-collections"', [('isa', 'XCRemoteSwiftPackageReference'), ('repositoryURL', '"https://github.com/apple/swift-collections"'), ('requirement', {'kind': 'upToNextMajorVersion', 'minimumVersion': '1.1.0'})])
pkg_prod = obj('XCSwiftPackageProductDependency', 'OrderedCollections', [('isa', 'XCSwiftPackageProductDependency'), ('package', (pkg, 'XCRemoteSwiftPackageReference "swift-collections"')), ('productName', 'OrderedCollections')])
files[pkg_prod] = 'OrderedCollections'


def phase(isa, name, bfiles, extra=None):
    f = [('isa', isa), ('buildActionMask', '2147483647'), ('files', [(b, O[b][1]) for b in bfiles]), ('runOnlyForDeploymentPostprocessing', '0')]
    if extra:
        f[3:3] = extra
    return obj(isa, name, f)


def pkg_bfile():
    return obj('PBXBuildFile', 'OrderedCollections in Frameworks', [('isa', 'PBXBuildFile'), ('productRef', (pkg_prod, 'OrderedCollections'))])


# app target
a_src = phase('PBXSourcesBuildPhase', 'Sources', [bfile(app_swift, 'Sources'), bfile(content, 'Sources'), bfile(model, 'Sources'), bfile(old, 'Sources')])
a_fw = phase('PBXFrameworksBuildPhase', 'Frameworks', [pkg_bfile()])
a_res = phase('PBXResourcesBuildPhase', 'Resources', [bfile(assets, 'Resources')])
embed_bf = obj('PBXBuildFile', 'ZovoDemoWidget.appex in Embed Foundation Extensions', [('isa', 'PBXBuildFile'), ('fileRef', (wid_p, 'ZovoDemoWidget.appex')), ('settings', {'ATTRIBUTES': ['RemoveHeadersOnCopy']})])
a_embed = phase('PBXCopyFilesBuildPhase', 'Embed Foundation Extensions', [embed_bf], [('dstPath', '""'), ('dstSubfolderSpec', '13'), ('name', '"Embed Foundation Extensions"')])
a_script = obj('PBXShellScriptBuildPhase', 'Write build number', [('isa', 'PBXShellScriptBuildPhase'), ('buildActionMask', '2147483647'), ('files', []), ('inputFileListPaths', []), ('inputPaths', ['"$(SRCROOT)/ZovoDemo/Info.plist"']), ('name', '"Write build number"'), ('outputFileListPaths', []), ('outputPaths', []), ('runOnlyForDeploymentPostprocessing', '0'), ('shellPath', '/bin/sh'), ('shellScript', '"# Writes the commit count as the build number\\nbuild=$(git rev-list --count HEAD 2>/dev/null || echo 1)\\n/usr/libexec/PlistBuddy -c \\"Set :CFBundleVersion $build\\" \\"$TARGET_BUILD_DIR/$INFOPLIST_PATH\\"\\n"')])
# widget target
w_src = phase('PBXSourcesBuildPhase', 'Sources', [bfile(widget, 'Sources'), bfile(model, 'Sources')])
w_fw = phase('PBXFrameworksBuildPhase', 'Frameworks', [bfile(widgetkit, 'Frameworks')])
w_res = phase('PBXResourcesBuildPhase', 'Resources', [])
# tests
t_src = phase('PBXSourcesBuildPhase', 'Sources', [bfile(tests, 'Sources')])
t_fw = phase('PBXFrameworksBuildPhase', 'Frameworks', [])


def config(name, settings, basecfg=None):
    f = [('isa', 'XCBuildConfiguration')]
    if basecfg:
        f.append(('baseConfigurationReference', (basecfg, files[basecfg])))
    f += [('buildSettings', settings), ('name', name)]
    return obj('XCBuildConfiguration', name, f)


def clist(owner, debug, release):
    return obj('XCConfigurationList', 'Build configuration list for %s' % owner, [('isa', 'XCConfigurationList'), ('buildConfigurations', [(debug, 'Debug'), (release, 'Release')]), ('defaultConfigurationIsVisible', '0'), ('defaultConfigurationName', 'Release')])


proj_common = {'ALWAYS_SEARCH_USER_PATHS': 'NO', 'CLANG_ENABLE_MODULES': 'YES', 'IPHONEOS_DEPLOYMENT_TARGET': '17.0', 'SDKROOT': 'iphoneos', 'SWIFT_VERSION': '5.0', 'TARGETED_DEVICE_FAMILY': '"1,2"'}
pd = config('Debug', dict(proj_common, DEBUG_INFORMATION_FORMAT='dwarf', ENABLE_TESTABILITY='YES', GCC_OPTIMIZATION_LEVEL='0', ONLY_ACTIVE_ARCH='YES', SWIFT_ACTIVE_COMPILATION_CONDITIONS='"DEBUG $(inherited)"', SWIFT_OPTIMIZATION_LEVEL='"-Onone"'), base_cfg)
pr = config('Release', dict(proj_common, DEBUG_INFORMATION_FORMAT='"dwarf-with-dsym"', SWIFT_COMPILATION_MODE='wholemodule', VALIDATE_PRODUCT='YES'), release_cfg)
app_common = {'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon', 'CODE_SIGN_ENTITLEMENTS': 'ZovoDemo/ZovoDemo.entitlements', 'CODE_SIGN_STYLE': 'Automatic', 'CURRENT_PROJECT_VERSION': '12', 'INFOPLIST_FILE': 'ZovoDemo/Info.plist', 'LD_RUNPATH_SEARCH_PATHS': ['"$(inherited)"', '"@executable_path/Frameworks"'], 'MARKETING_VERSION': '1.4.0', 'PRODUCT_BUNDLE_IDENTIFIER': 'com.example.zovodemo', 'PRODUCT_NAME': '"$(TARGET_NAME)"'}
ad = config('Debug', dict(app_common, SWIFT_ACTIVE_COMPILATION_CONDITIONS='"$(inherited) DEMO_DATA"'))
ar = config('Release', dict(app_common))
wid_common = {'CODE_SIGN_STYLE': 'Automatic', 'CURRENT_PROJECT_VERSION': '12', 'INFOPLIST_FILE': 'ZovoDemoWidget/Info.plist', 'LD_RUNPATH_SEARCH_PATHS': ['"$(inherited)"', '"@executable_path/Frameworks"', '"@executable_path/../../Frameworks"'], 'MARKETING_VERSION': '1.4.0', 'PRODUCT_BUNDLE_IDENTIFIER': 'com.example.zovodemo.widget', 'PRODUCT_NAME': '"$(TARGET_NAME)"', 'SKIP_INSTALL': 'YES'}
wd = config('Debug', dict(wid_common))
wr = config('Release', dict(wid_common))
tst_common = {'BUNDLE_LOADER': '"$(TEST_HOST)"', 'CODE_SIGN_STYLE': 'Automatic', 'GENERATE_INFOPLIST_FILE': 'YES', 'PRODUCT_BUNDLE_IDENTIFIER': 'com.example.zovodemo.tests', 'PRODUCT_NAME': '"$(TARGET_NAME)"', 'TEST_HOST': '"$(BUILT_PRODUCTS_DIR)/ZovoDemo.app/ZovoDemo"'}
td_ = config('Debug', dict(tst_common))
tr_ = config('Release', dict(tst_common))
plist = clist('PBXProject "ZovoDemo"', pd, pr)
alist = clist('PBXNativeTarget "ZovoDemo"', ad, ar)
wlist = clist('PBXNativeTarget "ZovoDemoWidget"', wd, wr)
tlist = clist('PBXNativeTarget "ZovoDemoTests"', td_, tr_)

ROOT_ID = 'A0D0E0000000000000000F00'
n[0] = 0x100
wid_t = nid()
app_t = nid()
tst_t = nid()
prox_w = obj('PBXContainerItemProxy', 'PBXContainerItemProxy', [('isa', 'PBXContainerItemProxy'), ('containerPortal', (ROOT_ID, 'Project object')), ('proxyType', '1'), ('remoteGlobalIDString', wid_t), ('remoteInfo', 'ZovoDemoWidget')])
prox_a = obj('PBXContainerItemProxy', 'PBXContainerItemProxy', [('isa', 'PBXContainerItemProxy'), ('containerPortal', (ROOT_ID, 'Project object')), ('proxyType', '1'), ('remoteGlobalIDString', app_t), ('remoteInfo', 'ZovoDemo')])
dep_w = obj('PBXTargetDependency', 'PBXTargetDependency', [('isa', 'PBXTargetDependency'), ('target', (wid_t, 'ZovoDemoWidget')), ('targetProxy', (prox_w, 'PBXContainerItemProxy'))])
dep_a = obj('PBXTargetDependency', 'PBXTargetDependency', [('isa', 'PBXTargetDependency'), ('target', (app_t, 'ZovoDemo')), ('targetProxy', (prox_a, 'PBXContainerItemProxy'))])
files.update({wid_t: 'ZovoDemoWidget', app_t: 'ZovoDemo', tst_t: 'ZovoDemoTests'})


def target(oid, name, clist_, phases, deps, prod, ptype, pkgs=None):
    f = [('isa', 'PBXNativeTarget'), ('buildConfigurationList', (clist_, O[clist_][1])), ('buildPhases', [(p, O[p][1]) for p in phases]), ('buildRules', []), ('dependencies', [(d, 'PBXTargetDependency') for d in deps]), ('name', name)]
    if pkgs is not None:
        f.append(('packageProductDependencies', [(p, files[p]) for p in pkgs]))
    f += [('productName', name), ('productReference', (prod, files[prod])), ('productType', '"%s"' % ptype)]
    obj('PBXNativeTarget', name, f, oid)


target(app_t, 'ZovoDemo', alist, [a_script, a_src, a_fw, a_res, a_embed], [dep_w], app_p, 'com.apple.product-type.application', [pkg_prod])
target(wid_t, 'ZovoDemoWidget', wlist, [w_src, w_fw, w_res], [], wid_p, 'com.apple.product-type.app-extension')
target(tst_t, 'ZovoDemoTests', tlist, [t_src, t_fw], [dep_a], tst_p, 'com.apple.product-type.bundle.unit-test')
obj('PBXProject', 'Project object', [
    ('isa', 'PBXProject'),
    ('attributes', {'BuildIndependentTargetsInParallel': '1', 'LastSwiftUpdateCheck': '1600', 'LastUpgradeCheck': '1600', 'ORGANIZATIONNAME': '"Zovo Demo"'}),
    ('buildConfigurationList', (plist, O[plist][1])), ('compatibilityVersion', '"Xcode 14.0"'), ('developmentRegion', 'en'), ('hasScannedForEncodings', '0'),
    ('knownRegions', ['en', 'Base', 'de']), ('mainGroup', (main_g, None)),
    ('packageReferences', [(pkg, 'XCRemoteSwiftPackageReference "swift-collections"')]),
    ('productRefGroup', (prod_g, 'Products')), ('projectDirPath', '""'), ('projectRoot', '""'),
    ('targets', [(app_t, 'ZovoDemo'), (wid_t, 'ZovoDemoWidget'), (tst_t, 'ZovoDemoTests')]),
], ROOT_ID)


def ref(v):
    i, c = v
    return i if c is None else '%s /* %s */' % (i, c)


def val(v, ind):
    if isinstance(v, tuple):
        return ref(v)
    if isinstance(v, list):
        if not v:
            return '(\n%s)' % ('\t' * ind)
        return '(\n' + ''.join('%s%s,\n' % ('\t' * (ind + 1), ref(x) if isinstance(x, tuple) else val(x, ind + 1)) for x in v) + '\t' * ind + ')'
    if isinstance(v, dict):
        return '{\n' + ''.join('%s%s = %s;\n' % ('\t' * (ind + 1), k, val(v[k], ind + 1)) for k in sorted(v)) + '\t' * ind + '}'
    return v if v.startswith('"') else q(v)


def emit(oid):
    isa, comment, fields = O[oid]
    head = '\t\t%s%s = ' % (oid, ' /* %s */' % comment if comment else '')
    if isa in ('PBXBuildFile', 'PBXFileReference'):
        return head + '{' + ''.join('%s = %s; ' % (k, val(v, 0) if not isinstance(v, (list, dict)) else val(v, 0).replace('\n', ' ').replace('\t', '')) for k, v in fields) + '};\n'
    return head + '{\n' + ''.join('\t\t\t%s = %s;\n' % (k, val(v, 3)) for k, v in fields) + '\t\t};\n'


out = ['// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 60;\n\tobjects = {\n']
for isa in sorted({o[0] for o in O.values()}):
    out.append('\n/* Begin %s section */\n' % isa)
    for oid in sorted(k for k in O if O[k][0] == isa):
        out.append(emit(oid))
    out.append('/* End %s section */\n' % isa)
out.append('\t};\n\trootObject = %s /* Project object */;\n}\n' % ROOT_ID)
proj = os.path.join(ROOT, 'ZovoDemo.xcodeproj')
os.makedirs(proj, exist_ok=True)
with open(os.path.join(proj, 'project.pbxproj'), 'w') as fh:
    fh.write(''.join(out))

SRC = {
    'ZovoDemo/ZovoDemoApp.swift': 'import SwiftUI\n\n@main\nstruct ZovoDemoApp: App {\n    var body: some Scene {\n        WindowGroup { ContentView() }\n    }\n}\n',
    'ZovoDemo/ContentView.swift': 'import SwiftUI\n\nstruct ContentView: View {\n    @State private var store = TripStore()\n    var body: some View {\n        List(store.trips, id: \\.self) { Text($0) }\n    }\n}\n',
    'ZovoDemo/TripStore.swift': 'import Foundation\n\n@Observable\nfinal class TripStore {\n    var trips = ["Lisbon", "Kyoto", "Oaxaca"]\n}\n',
    'ZovoDemo/Info.plist': '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>CFBundleDisplayName</key>\n\t<string>Zovo Demo</string>\n</dict>\n</plist>\n',
    'ZovoDemo/ZovoDemo.entitlements': '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>com.apple.security.application-groups</key>\n\t<array>\n\t\t<string>group.com.example.zovodemo</string>\n\t</array>\n</dict>\n</plist>\n',
    'ZovoDemo/Assets.xcassets/Contents.json': '{\n  "info" : {\n    "author" : "xcode",\n    "version" : 1\n  }\n}\n',
    'ZovoDemoWidget/TripWidget.swift': 'import WidgetKit\nimport SwiftUI\n\nstruct TripWidget: Widget {\n    var body: some WidgetConfiguration {\n        StaticConfiguration(kind: "TripWidget", provider: TripProvider()) { _ in Text("Next trip") }\n    }\n}\n',
    'ZovoDemoWidget/Info.plist': '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>NSExtension</key>\n\t<dict>\n\t\t<key>NSExtensionPointIdentifier</key>\n\t\t<string>com.apple.widgetkit-extension</string>\n\t</dict>\n</dict>\n</plist>\n',
    'ZovoDemoTests/TripStoreTests.swift': 'import XCTest\n@testable import ZovoDemo\n\nfinal class TripStoreTests: XCTestCase {\n    func testTrips() { XCTAssertEqual(TripStore().trips.count, 3) }\n}\n',
    'Config/Base.xcconfig': '// Shared settings for every configuration\nSWIFT_VERSION = 5.0\nENABLE_USER_SCRIPT_SANDBOXING = YES\nOTHER_SWIFT_FLAGS = -warn-concurrency\n',
    'Config/Release.xcconfig': '#include "Base.xcconfig"\n\nSWIFT_OPTIMIZATION_LEVEL = -O\nOTHER_SWIFT_FLAGS = $(inherited) -enforce-exclusivity=checked\n',
}
for rel, text in SRC.items():
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w') as fh:
        fh.write(text)
print('wrote', os.path.join(proj, 'project.pbxproj'), len(O), 'objects')
