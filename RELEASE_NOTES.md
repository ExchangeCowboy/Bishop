# Bishop 0.12 alpha

Initial public alpha release, tagged `v0.12.0-alpha`.

## Install

1. Install Node.js 24+ with npm and sign in to the Codex app or native CLI with ChatGPT.
2. Download `Bishop-0.12.0-alpha-windows.zip` and extract the entire archive into a writable folder.
3. Double-click `install.cmd`. The installer checks prerequisites, installs dependencies, and registers `bishop` on your user PATH.
4. Open a new terminal, run `bishop chat`, and complete personal onboarding.

No separate Bishop account or API key is needed. See the
[installation guide](https://github.com/ExchangeCowboy/Bishop/blob/v0.12.0-alpha/INSTALLATION.md).

## Included

- ChatGPT model access through the installed Codex runtime and existing login.
- Editable TOML settings, Markdown personality, and reusable skills.
- Host commands, file patching, web search, and public page reading.
- Local conversation archives, searchable SQLite memory, and resumable memory review.
- Context compaction, activity/status display, and per-run usage reporting.
- Windows installer and clean first-run defaults with an empty soul and memory.

The ZIP contains committed project files and the installer. Node.js, Codex, npm
dependencies, personal memory, transcripts, and local development backups are not bundled.
A SHA-256 checksum accompanies the ZIP.

## Alpha status

All 129 local tests, type checking, offline demo, and fresh-start checks passed.
Installer tests use simulated dependencies; a clean-machine installation has not
been tested. Codex access and rate limits remain those of your ChatGPT account.
