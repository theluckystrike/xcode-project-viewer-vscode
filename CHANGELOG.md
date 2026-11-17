# Changelog

## 0.1.1

- The Targets tab stays readable in a narrow editor, such as VS Code's default layout with the secondary side bar open. Below about 900 pixels the project facts move under the main view, and file paths in the build phases and the values on the Build Settings tab keep a minimum width (the view scrolls sideways instead of showing one letter per line).
- The "Tools that often go with Xcode projects" step links only to extensions that VS Code can open from the Marketplace: Git Commit Graph, SVG Preview & Viewer and JSON Tree Viewer. The plist editor is not on the Marketplace yet, and the APK Analyzer page does not open in VS Code at the moment.
- Nothing else changed: same viewer, same Pro tools with 1 free try each, same prices.

## 0.1.0

- First release. Opens project.pbxproj as a project view: targets and their build phases, the file and group tree, build settings, Swift packages and project facts. The text editor stays the default; the viewer opens from the editor title button, the Explorer menu, the Command Palette or Open With.
- Build settings for each target and configuration, with the level that sets each value, .xcconfig files read and $(inherited) resolved.
- Warnings for objects that point to removed ids, objects defined twice, entries listed twice and files missing on disk.
- Search in every tab, and a click on a row opens its line in the text.
- Zovo Pro tools: Merge conflict helper, Compare two project versions, Build settings export and compare (1 free try each).
