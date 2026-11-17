# Third-party notices

The extension ships no third-party code. The project file reader, the build settings resolver, the checks, the merge fix and the comparison are written for this extension. The OpenStep property list parser (src/core/openstep.js) is copied from the Zovo Plist Viewer & Editor extension (same author, MIT).

## Sample files

samples/ (the ZovoDemo project, its Swift files and .xcconfig files) was written for this extension by scripts/make-sample.py (MIT, like the extension). It describes a made-up app and is not a real product.

## Test files (in the source repository, not in the extension package)

test/fixtures/ holds project.pbxproj files from two open source apps, both MIT licensed:

- Kingfisher, https://github.com/onevcat/Kingfisher, Copyright (c) 2019 Wei Wang. The kf-merge-* files are merge conflicts rebuilt from its git history with `git merge-file`.
- NetNewsWire, https://github.com/Ranchero-Software/NetNewsWire, Copyright (c) 2002-2025 Brent Simmons.

test/fixtures/SOURCES.txt lists the exact commits.
