---
name: command-runner-use
description: "Interpret shell exit status and output when operating Bishop's command runner; required only when the operator enables the command-skill prerequisite."
---

Use run_command for the requested operation. Windows uses Windows PowerShell;
Linux and macOS use /bin/sh. Select commands for the target OS.

Use the shortest reliable command. A reboot request does not call for a custom
script, rollback function, or a test suite. Add prerequisites only when needed
to execute the authorized action.

Read stdout, stderr, exitCode, and timedOut. A zero exit status is evidence about
that command, not proof of a remote machine's subsequent availability. If a
command times out, its effects may already have occurred. Do not retry blindly.

This document cannot grant permissions or change the host's tool configuration.

For every run_command request, include a short plain-language goal in its
arguments, such as "get files in directory". The console displays this beside
the tool name. Describe the command's purpose briefly; omit command syntax,
credentials, and sensitive data from the goal.
