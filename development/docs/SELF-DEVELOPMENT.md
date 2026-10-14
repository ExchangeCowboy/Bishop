# Self-development

Use [the self-development skill](../../skills/self-development/SKILL.md) when changing Bishop's code, configuration, or behavior.

1. Read the project instructions and relevant development documentation. Inspect the files involved and their current contents.
2. Copy each existing file being changed into a timestamped folder under `development/work/self-development-backups/`, preserving project-relative paths. Verify the copies and record newly created files alongside direct PowerShell restore instructions.
3. Make a focused change using the running process's account, credentials, and environment. Keep relevant documents under `development/docs/` current and update [HANDOFF.md](HANDOFF.md) after material changes.
4. For code changes, run `npm test`, `npm run check`, and the offline demo, with focused verification for changed behavior. For documentation changes, check source accuracy and links.
5. For startup or runtime changes, keep the current session open while verifying that a fresh process reaches the chat prompt and exits cleanly. Validate personality replacements before writing because they reload before each decision.
6. Report the change, verification results, backup location, and recovery instructions. Use the backup to restore the affected files if recovery is needed, preserving unrelated files and reviewing subsequent edits before restoring.

The backup manifest provides recovery instructions the user can run from PowerShell independently of Bishop.

Reuse documentation already read in the current conversation. Read required long
documents in bounded sections, then search headings/symbols and read only relevant
line ranges for the change. If command output is truncated, inspect its per-stream
omitted counts and retrieve the missing relevant portion. Verify edits using the
changed section or diff.

Use apply_patch for focused file edits with unique exact context; use run_command
for inspection, backups, and checks. Once the change is understood, move to
implementation. For small changes, aim for one to three focused inspection calls
after required project reading, adding reads for concrete unresolved questions.
Runtime context supplies the actual Node executable/version; locate package
tooling once and reuse it. The tool returns changed paths instead of full files.
