# Bishop Agent

Codex workspace: your Bishop project directory.
Application and Git root: the workspace root.
Run the commands below from the project root.

A small, inspectable personal agent built with TypeScript and Node.js. Bishop
owns the conversation loop, tool execution, and on-demand skill library.

The model adapter requires the **installed Codex app or CLI and its ChatGPT sign-in**.
Bishop checks that connection before creating a session or starting onboarding. Codex remains
a runtime dependency in this first slice. This is not yet a wholly independent
model client, and Codex's underlying model instructions and policies still apply.
No credentials are copied or read by Bishop; Codex handles authentication.

## Run

For the Windows installation walkthrough, see [INSTALLATION.md](../../INSTALLATION.md).
The included install.cmd opens install.ps1; it checks Node/npm and the existing
Codex ChatGPT login, installs locked runtime dependencies, then registers Bishop
on user PATH. -NoPath skips registration. It preserves config, personality and
memory and does not launch onboarding or make a model request.

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Requirements: Node.js 24+, and a recent Codex runtime with `exec --ignore-user-config`,
`--output-schema`, and `--ephemeral`. The CLI must be signed in with ChatGPT:

```powershell
codex login status
# If needed, run codex login and complete the browser sign-in.
node app/cli.ts
```

On this Windows workspace, the bundled Node runtime can be used without a global
installation:

```powershell
.\start.ps1 --help
.\start.ps1
```

On Windows, register this checkout as the `bishop` command once:

```powershell
.\install-command.ps1
bishop chat
bishop --help
```

The installer adds the project directory to user PATH without copying the app.
Reopen existing terminals if they have the old PATH. `bishop` alone also starts
chat, and all existing flags work with `bishop chat`. Only `chat` is implemented.
install-command.ps1 remains a registration-only alternative for an already
installed checkout; it does not install dependencies or check prerequisites.

Cross-platform npm commands:

```sh
npm install
npm start
npm start -- --session work
npm start -- --prompt "Explain what tools you have."
```

The command runner is built in and available by default. Use `/exit` to leave
interactive chat. Commands execute under your existing OS permissions.

## Configuration

Soul refinements live in config/personality/soul.md, under 2,000 characters.
The bishop-core-profiler skill guides edits and removes duplication. update_soul
is enabled by default and can be disabled in config/bishop.toml. Changes made
through it take effect in subsequent model requests without restarting.

Model-facing harness instructions are editable in `config/harness.md` at the
project root. Restart after editing harness instructions or TOML settings.
Personality stays in `config/personality/` and refreshes before model decisions.
Keep the harness template's instructions, tools, and conversation placeholders;
the schema and actual tool execution remain application code.

Edit `config/bishop.toml`:

```toml
[tools]
run_command = true  # Run terminal commands.
load_skill = true   # Read saved skill instructions.
save_skill = true   # Create or update skills.

[provider]
# Leave model unset to use the Codex runtime's default.
# model = "your-model-id"
```

Set any tool to `false` to disable it, then restart Bishop. A disabled tool is
hidden from the model and blocked by the dispatcher even if the model requests
it from memory. Tools omitted from the configuration are enabled by default.
A missing config file also uses these defaults. Invalid TOML, misspelled tool
names, and non-boolean settings stop startup with a configuration error.

For example, `run_command = false` disables shell execution while leaving
skill loading and saving available. The file is read at startup, not after
every tool call. If using `--require-command-skill`, leave `load_skill` enabled
so the model can satisfy the prerequisite.

Lines starting with `#` are comments. Sections use square brackets, text values
use quotes, and booleans use `true` or `false` without quotes. The shipped file
includes explanations beside the settings. Older installations with only
`config/bishop.json` still load that file; if both exist, TOML takes precedence.

Use `--cwd PATH` for the command runner's working directory, `--session NAME`
to label a new transcript. Every launch starts with an empty conversation,
including launches using the same session label. Previous transcripts stay on
disk and are never automatically reloaded into model context. Within a launch,
Bishop remembers the ongoing conversation. Set `provider.model` in the config to select
the model. `--model ID` remains an optional override for one launch; if neither
is specified, the Codex runtime's default model is used. The provider section
is the place for future connection and authentication settings. At present,
only `model` is implemented; the adapter still uses Codex's ChatGPT login.
Bishop ignores Codex's user
configuration for its backend invocation to avoid importing custom integrations;
it reuses the authentication store. Model availability and subscription limits
remain those of your account.

On Windows, Bishop discovers the Codex desktop app's executable even when it is
not on PATH. If automatic discovery fails, set `BISHOP_CODEX_BIN` to its actual executable. On Windows,
use `codex.exe` or another executable, not an npm `.cmd` shim; shim discovery is a
future portability task. Discovery is repeated at launch so desktop app updates
can change the executable's versioned installation directory.

## Offline demo and checks

```sh
npm run demo
npm test
npm run check
```

The demo uses a deterministic fake provider. It loads a skill and, unless disabled in config,
prints a fixed harmless message through the shell. It does not interpret tasks,
call a model, or require credentials. The runtime dependency smol-toml parses the settings file; the development
dependencies provide TypeScript checks.

## Implemented in 0.1.0

- Interactive and one-shot chat through the subscription adapter.
- Explicit model-to-tool-to-model loop, one action at a time, with a step limit.
- PowerShell on Windows and `/bin/sh` elsewhere, returning output, exit status,
  timeout status, and truncation status.
- Skill catalog containing names and short descriptions; full bodies load on demand.
- Skill creation and updates, retaining the prior document in local revision storage.
- Optional command prerequisite: `--require-command-skill` requires loading the
  current `command-runner-use` hash during the current user turn. No magic prefix.
- Local transcript persistence under `memory/history/`, including tool outcomes.
- Fresh conversation context on every launch; prior transcripts are retained as files.
- Visible tool names and success/failure status in the terminal.
- Automatic working-context compaction above 400,000 characters by default;
  `[context] compact_at_characters` configures the threshold. Full transcripts
  remain intact, and `/new` resets the checkpoint. The harness guard is 500,000
  characters; neither value specifies the provider's model context window. Summary behavior lives in
  `config/compaction.md`; the console shows when compaction runs.
- DuckDuckGo search and compact persistent facts in memory.md.

## Still to build

Full page reading, visual browser/desktop control, independently
managed provider OAuth and API-key adapters, streaming model text, broader
memory retrieval, background autonomy, stronger process
cancellation, credential-store integration, and installers for all three OSes.

Saved conversations are history, not an autonomous learning or memory system.
Markdown is the convention for instructions/prose; settings use commented TOML
with INI-style sections. Internal transcripts and tool payloads remain JSON.
Skill writing is available, but procedure correctness is not automatically proven.
The hash prerequisite proves delivery of current instructions, not compliance.

The command timeout terminates the immediate shell process; it does not guarantee
termination of every descendant process. Tools with persistent jobs need a
separate lifecycle design. Local transcripts contain user messages and command
output; do not treat them as secret-free logs. Concurrent writers to the same
session or skill library are not supported in this starter.

## Source map

| File | Responsibility |
| --- | --- |
| `app/personality.ts` | Load editable behavior Markdown |
| `tools/run-command.ts` | Execute host-shell commands |
| `app/cli.ts` | User interface and session selection |
| `app/config.ts` | Main configuration loading and validation |
| `app/agent.ts` | Conversation loop and task-scope instructions |
| `app/providers/codex.ts` | ChatGPT subscription access through Codex |
| `app/providers/codex-path.ts` | Codex executable discovery and setup errors |
| `app/providers/demo.ts` | Offline plumbing demonstration |
| `tools/index.ts` | Tool validation, execution, and skill prerequisites |
| `app/process.ts` | OS process launching and output capture |
| `app/skills.ts` | Skill discovery, loading, hashes, and revisions |
| `app/session.ts` | Local conversation persistence |
| `config/personality/bishop.md` | Voice, judgment, and execution instructions |

## Design reference

The project brief and next milestones are in [docs/PROJECT.md](PROJECT.md).
Implementation details are in [docs/ARCHITECTURE.md](ARCHITECTURE.md), and
future Codex sessions should start with [docs/HANDOFF.md](HANDOFF.md).
Authentication and integration references: [Codex authentication](https://learn.chatgpt.com/docs/auth),
[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), and
[non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode).
These document the supported Codex integration; they do not imply unrestricted
subscription access to every OpenAI API or model.
