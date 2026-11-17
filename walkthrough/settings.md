# Build settings and broken references

- The Build Settings tab lists the settings of one target (or the project) for one configuration. "Set at" says whether the value comes from the target, the project or an .xcconfig file, and $(inherited) is resolved from the level below.
- Settings that only Xcode's SDK defaults give are not in the project file, so they are not listed.
- The Warnings tab lists objects that point to removed ids, objects defined twice, entries listed twice, and files or folders that are not on disk next to the .xcodeproj folder.
- A click on a line link opens project.pbxproj in the text editor at that line. The viewer itself never changes the file.
