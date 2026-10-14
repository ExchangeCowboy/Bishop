---
name: self-development
description: "Develop Bishop with focused reads, direct patches, verified backups, current documentation, and proportionate checks; minimize repeated context and model decisions."
---

# Self-development

Make the smallest reliable change that fulfills the user's request. Optimize for completed, verified work with few model decisions and little repeated context.

## Understand, then act

Work from Bishop's actual project root. Read AGENTS.md and development/docs/HANDOFF.md, PROJECT.md, and ARCHITECTURE.md before changing code, using bounded sections and prioritizing current status, project scope, and the architecture relevant to the change. Use headings to find applicable instructions; consult historical handoff entries when they resolve an actual question. Reuse delivered content on later turns and inspect only changed or unclear portions. Search relevant symbols, then read the few implementation files needed for the requested behavior. Each read should resolve a specific question.

Once you can identify the required edit, move to backup and implementation. For a small feature, aim for one to three focused inspection calls after the required documentation, adding more only for a concrete unresolved dependency. Group short independent searches; keep each result complete. For truncated output, retrieve only the missing relevant section. Verify edits by inspecting the changed section or diff.

Use the running process's account, credentials, and inherited environment, including service hosting. Runtime context supplies the exact Node executable and version; use that path when Node is absent from shell PATH. Locate package tooling once from documented setup or startup discovery and reuse it throughout the task. Keep command output brief and useful.

## Back up and patch

Before editing, copy each affected existing file to a timestamped folder under development/work/self-development-backups/, preserving project-relative paths and existing local changes. Verify the copies. Record changed and new files, project root, backup location, and direct PowerShell restore instructions in a short manifest the user can use independently of Bishop.

Use apply_patch for focused code, configuration, and documentation edits. Include unique exact original context in each update hunk and group related file edits into one coherent patch. Read its compact result; on mismatch, reread the affected section and correct the patch. On a write failure, inspect data.files and affected paths before retrying. Use run_command for inspection, backups, and validation.

Update relevant development/docs alongside the implementation and HANDOFF.md after material changes. Keep actual behavior distinct from plans.

## Verify and report

After code changes, run npm test, npm run check, and the offline demo. Add focused checks for meaningful changed behavior. Use harmless commands, temporary files, and fake providers. Run independent checks together when practical; repeat them when fixes or unresolved failures justify it. Documentation-only changes need source and link checks.

For runtime or startup changes, keep the current session open while a fresh process reaches the chat prompt and exits cleanly. Validate config syntax and required harness placeholders. Personality refreshes each decision: prepare complete validated replacements, use update_soul with current bishop-core-profiler delivery, update_memory for the notebook, and save_skill for procedures.

If validation fails, fix the focused change or restore affected files, preserving unrelated settings, soul, memory, and local edits. Recheck restored behavior before relaunching. Report changed behavior, documentation, passed or blocked checks, backup/restore location, and remaining work. Distinguish saved edits from verified behavior.
