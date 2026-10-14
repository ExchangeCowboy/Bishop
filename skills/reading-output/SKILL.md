---
name: reading-output
description: "Optional guide for targeted file reads and recovering truncated command output without repeated work."
---

# Reading output

Reuse file contents and tool evidence already present in this conversation.
Choose each new read to resolve a specific missing fact. For long files, search
for relevant headings or symbols, then request bounded sections with paths and
line numbers. Read required project documentation once in manageable sections;
on later turns, reuse it and check only portions that changed or remain unclear.
Keep separate file reads small enough to see where each excerpt ends.

Command stdout and stderr retain only their initial prefixes when truncated.
When truncated=true, data.output gives the per-stream limit, total characters,
and omitted characters (UTF-16 units). Exit status describes execution; omitted
output means the evidence is incomplete. Retrieve only the missing relevant
section, using a narrower query or the next line range. For generated output,
save it to a task-local file on the original run when appropriate and inspect
that file in sections. Reuse the captured prefix and check the resulting state
before repeating a command with side effects. After editing, verify the changed
section or diff rather than dumping all project documents again.
