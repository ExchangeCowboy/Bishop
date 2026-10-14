---
name: apply-patch-use
description: "Full Bishop apply_patch syntax, examples, and recovery for unfamiliar patches or mismatch/write failures. Optional reference; direct patching remains available."
---

# Apply patch

Use apply_patch for focused text changes. Paths are relative to the current working
directory (absolute paths inside it also work). The patch is a string beginning
with "*** Begin Patch" and ending with "*** End Patch", each on its own line.
Add files with "*** Add File: path" and + prefixed content lines. Delete files with
"*** Delete File: path" and no body. Update files with "*** Update File: path",
a bare "@@" before each hunk, then space-prefixed unchanged lines, - removed
lines, and + added lines. Include enough exact original context for a unique match.
An optional "*** End of File" after a hunk anchors it at the file's end.

Example patch value:
```text
*** Begin Patch
*** Update File: app/example.ts
@@
-const count = 1;
+const count = 2;
*** End Patch
```

The tool validates all files before writing and returns only changed paths and
operations. For a mismatch, reread the affected section and correct the patch.
For a write failure, inspect data.files for any completed edits before retrying.
Use update_soul, update_memory, and save_skill for their dedicated targets.
