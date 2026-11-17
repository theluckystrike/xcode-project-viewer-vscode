# Xcode Project Viewer (pbxproj) 0.1.0 (zovo.zovo-xcode-project-viewer)

New listing, staged only. NICHE7 row 8, built by lane NEWB14.

- vsix: out/NEWB14-dist/zovo.zovo-xcode-project-viewer/zovo.zovo-xcode-project-viewer-0.1.0.vsix
- sha256: 78d9092e8ace28695af4258d1320a57403db682be9f73391c4b4ec363647717e (351,808 bytes, 49 files)
- Product repo: factory/products/xcode-project-viewer-vscode, local commits only (no remote). The vsix was packaged from commit 3107b11.
- Unit tests: 247 of 247 pass with `npm test` (scripts/test.js). `node --test` in the repo root runs 249 of 249.
- Real-app gate: VS Code 1.142.0 on port 9458 through buildslot. Run "final" on this exact vsix: 70 PASS, 0 FAIL (out/NEWB14-data/xcode/xcode-gate-final.json and .tsv, gate-final.log, screenshots out/NEWB14-data/xcode/shots/xcode-final-*.png). Earlier runs: dev1 (63 PASS, 7 FAIL), dev2 (70 PASS, 1 FAIL), dev3 on the dev2 build (71 PASS, 0 FAIL, took the README screenshot).

## What it is

- Display name: Xcode Project Viewer (pbxproj) (30 characters). The phrase "xcode project" comes first, and the description starts with "Xcode project viewer".
- Keywords: xcode, pbxproj, ios, swift, xcodeproj. Engines: ^1.75.0. Activation: onUri, plus the implicit custom editor and command events. There is no "*" and no onStartupFinished.
- Free core (all three parts of the row):
  - A read-only custom editor `xcodeProj.viewer` for *.pbxproj with priority "option": the text editor stays the default. It opens from the editor title button, the Explorer right-click menu (on project.pbxproj, upper-case names included, or on a .xcodeproj folder), the Command Palette or Open With.
  - Tabs: Targets (build phases with their files, run script text, copy files destination, dependencies, Swift package products, synchronized folders, build configurations), Files (the group tree with paths and target membership), Build Settings (per target and configuration, the level that sets each value, .xcconfig files read with #include, $(inherited) resolved), Packages (location, version rule, products and the targets that use them) and Warnings.
  - Warnings: objects that point to removed ids, objects defined twice, keys set twice, entries listed twice, duplicate build files, unused entries, and files or folders missing on disk (checked relative to the folder that holds the .xcodeproj).
  - Search in every tab. Every line link opens project.pbxproj beside the viewer at that line.
  - A file with conflict markers, a property list that is not a project, a syntax error and an empty file each get a plain note with Open as Text. Works the same on Linux and Windows; no Xcode needed.
- No third-party code ships. The OpenStep parser is copied from the Zovo Plist Viewer & Editor (same author, MIT); a unit test checks it is byte-identical.
- Zovo Pro tools (1 free try each, module 2026-11-15.conv2, listing tag "xcode", tries key xcodeProj.proTrial, TRIAL_USES = 1 in src/pro.js, proinfo factory/sprint/license/proinfo/xcode.json without triesMax):
  - Merge conflict helper (row tool 1): resolves git conflict blocks (new entries from both sides kept; for settings changed on both sides the user picks the side; with a diff3 base the side that changed wins), removes objects defined twice, entries listed twice, build files that point to nothing and references to missing objects. It shows the fix as a diff beside the file and asks one question ("Apply the fix to ... and save it?"). Nothing is written before Apply and Save. Id comments and line endings are kept.
  - Compare two project versions (row tool 2): by object: targets added, removed or renamed, files added, removed, moved or renamed, target membership, build settings, Swift packages and dependencies. Markdown report.
  - Build settings export and compare (row tool 3): every setting of every target and configuration as CSV (formula-safe) or Markdown, or two targets side by side in a sortable table with an "only differences" filter and CSV or Markdown save.
- Row tool 4 (clean-up of files on disk that are not in the project) was not built. The free Warnings tab already lists project files missing on disk and duplicate build file entries.
- Nothing pops up on open. No network calls: webview CSP default-src 'none' with nonce scripts, no fetch or socket code. The Pro panel shows only after a click on a Pro tool with no tries left.

## Samples used

- Shipped: samples/ (the ZovoDemo project with 3 targets, a Swift package, two .xcconfig files and its Swift files), written for this extension by scripts/make-sample.py (MIT). One file (OldHelper.swift) is missing on disk on purpose so the Warnings tab has something to show.
- Unit-test fixtures (repo only, not in the vsix), MIT:
  - Kingfisher project.pbxproj, https://github.com/onevcat/Kingfisher at 21caad71af5d1cb34ab174786e75c864fd2417bd.
  - NetNewsWire project.pbxproj, https://github.com/Ranchero-Software/NetNewsWire at 76ba069e21376075e482374f1a033cd72ffdf4dc.
  - Two real merge conflicts rebuilt from Kingfisher history with `git merge-file` (merges e542964e and 3a46b0cd, with the base, both sides and the file the authors committed). test/fixtures/SOURCES.txt has the commits.
- Real-app gate (not shipped, downloaded once into newb14-work/xcode/dl, each in its own folder, never executed, 7.3 MB):
  - The Kingfisher source tree at 21caad71 (codeload.github.com tarball, MIT), used for the on-disk check with one file removed by the gate.
  - Alamofire project.pbxproj at dea4bab91767a971d6e112bc955c6a82295589b7 (MIT).
  - NetNewsWire project.pbxproj (as above, MIT).
  - Wikipedia iOS project.pbxproj, https://github.com/wikimedia/wikipedia-ios at 0919f3eafd0b47492b5dac93b818a90b126ae8aa (MIT), 1.3 MB with 4,524 objects.
  - The two Kingfisher merge conflicts above.

## Gate coverage (final)

- Expected values come from the files through the gate's own OpenStep reader (out/NEWB14-scripts/xcode/gpbx.mjs), not from the extension.
- Free core: nothing pops up on start. project.pbxproj opens as text by default and the editor title button opens the viewer. Targets, the app target's phases and files, the status counts, the facts and the toolbar Pro row ("1 free try" for 3 tools) match the file. The disk check finds exactly the one missing file of our sample, shown in Warnings and in the Files tree (24 rows, the gate's count). Search in Targets and Build Settings. Build Settings for the default configuration list every target setting with its value at "Target" and every project-only setting at "Project", plus a value from Base.xcconfig at its .xcconfig level. A setting link opens the text at that setting's line. Packages tab. Open as Text.
- Real files: Kingfisher with its source tree (71 Sources files; 199 paths looked up, exactly the one file the gate removed reported missing, no false dangling ids). Alamofire, NetNewsWire and Wikipedia open with target, object and package counts as the gate reads them.
- Broken files: conflict note with its 3 blocks, a plist that is not a project, a cut-off file, an empty file, no error toast.
- Explorer: right-click LOOSE.PBXPROJ and the Kingfisher.xcodeproj folder show Open Xcode Project Viewer and the 3 "Zovo Pro: " entries; both open the viewer.
- Pro tools:
  - Merge helper from the conflict note on the real Kingfisher merge e542: the diff and the question show and the file is unchanged until Apply and Save. After it, the file holds exactly the 315 objects the Kingfisher authors committed in that merge, with id comments kept; the try is counted; the diff tab closes; the viewer reloads the project. The 2nd use on another project (Explorer, KFMergeB.xcodeproj folder) opens the Pro panel and leaves the file untouched.
  - Compare from the toolbar row, Kingfisher base against current: files added and removed equal the gate's sets by id, and the 24 build setting changes equal the gate's count. Markdown saved. The 2nd use on another file (palette) opens the Pro panel.
  - Build settings from the toolbar row: CSV of real Kingfisher, 451 rows; per target and configuration the row count equals the union of project and target keys, values checked. The 2nd use on another file (Explorer, LOOSE.PBXPROJ) opens the Pro panel.
  - The Zovo Pro info tab lists the 3 tools with "no free tries left". No URL was opened at any point.
- End of run: no error toast, no notification from the extension, no webview network request, no extension host socket, no webview console or CSP error. After a VS Code restart with the same profile, the row shows "0 tries left" for all 3 tools and Compare opens the Pro panel. The window was closed and the profile deleted.

## Defects found and fixed in the gate runs

- Product (dev1): the Merge conflict helper put its changes into the Refactor Preview with needsConfirmation, and VS Code starts such changes unticked, so Apply there changed nothing and no fix was saved. The helper now shows the fixed text in a diff beside the file and asks one modal question with Apply and Save; the edit is then applied and saved. Unit tests updated (the diff, the question, Cancel uses no try, no needsConfirmation).
- Product (dev1 screenshot): an empty code box showed in the path column for package products. It is no longer drawn.
- Gate (dev1): the Build Settings check assumed Debug, but the tab opens on the project's default configuration (Release in our sample). The gate now reads the selected configuration and checks that it is the default.
- Gate (dev1, dev2): the README screenshot step did not close the side bar. It now uses Cmd+B when the palette command does not match.

## Known limits

- Xcode's own SDK defaults are not in the project file, so the Build Settings tab lists only the project, target and .xcconfig levels. Conditional settings such as KEY[sdk=iphoneos*] are listed under their full name and not evaluated.
- In the comparison, a list value and the same words in one string count as the same setting (newer Xcode rewrites strings as lists).
- Files inside synchronized folders (Xcode 16) are not listed one by one; the folder and its path are shown and checked on disk.
- The disk check needs the file inside a .xcodeproj folder; a loose .pbxproj opens with the check skipped.
- The gate drove Save dialogs through VS Code's simple file dialog, not the native macOS dialog.
