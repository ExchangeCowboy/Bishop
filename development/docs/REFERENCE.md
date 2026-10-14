# Bishop Agent

Tim Williams built this.

Requires Node.js 24+ and an installed Codex app or CLI signed in with ChatGPT.
Bishop reuses the local Codex login and checks it before starting chat; no separate
Bishop account is needed. Open Codex and sign in before launching Bishop.
The offline demo works without Codex. See [setup](../../development/docs/SETUP.md).

New installations begin personal onboarding with an empty soul and memory.
You choose the agent's personal name and purpose. The default model is selected
by Codex; set `provider.model` in the settings to override it.

For Windows installation, follow [INSTALLATION.md](../../INSTALLATION.md). Install
Node.js 24+ with npm, install/sign in to Codex, extract Bishop, then double-click
`install.cmd`. The installer checks prerequisites, installs runtime dependencies,
and registers the command. You can also run it from PowerShell:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Then start chat from any directory (reopen an existing terminal if needed):

```powershell
bishop chat
```

`bishop --help` lists options. `bishop chat --demo` runs the offline demo.
Running `bishop` also starts chat. Model configuration and doctor commands are
not implemented yet. The command runs this checkout; keep it at its registered
path, or rerun the installer after moving it.

The original launcher still works without registration:

```powershell
.\start.ps1
```

Every launch starts a fresh conversation. Tools are enabled by default.

The scrolling console shows the model, workspace, session, context settings, and
complete tool list. Tool activity is numbered with goals, timing, errors, and
patch file summaries. Replies include elapsed time, tool counts, and a compact
token footer. The blue live activity block redraws thinking, tool execution,
and compaction in place, then leaves completed results in the scrollback. Its
spinner and activity rail fit the current terminal width, with a one-row fallback
for narrow windows. Capable terminals pin three wrapped input rows at the bottom,
keeping the cursor visible in longer drafts, with a matching bright blue status
bar immediately above it, showing the abbreviated model and session IN/CACHE/OUT
tokens. Cached tokens are included in input; unknown counts show ?. Conversation
history stays above the live activity area. Mouse wheel and Page Up/Page Down
browse older text without losing your draft; incoming output preserves your
reading position. The status bar shows navigation hints. In terminals supporting
SGR mouse reports, hold Shift while dragging to select text. Page keys remain
available when mouse reporting is unsupported. The terminal scrollbar does not
contain the dock's full history. Dumb or redirected terminals retain regular logs.
Startup highlights `/help for commands`; `/help` lists the available commands.
Use `/status` for runtime settings, `/usage` for the latest
run's metrics, `/new` for a fresh chat, or `/exit` to quit.
`/new` saves the previous transcript and clears conversation context while
keeping the current settings and saved personality. Color is automatic in terminals;
`NO_COLOR` disables color. One-shot and redirected output stay plain.

## Where things live

```text
BishopAgent/
├── app/                    Runtime code and provider connections
├── config/
│   ├── bishop.toml          Model and tool settings
│   ├── harness.md           Model-facing harness instructions
│   └── personality/        Editable Markdown behavior
├── skills/
│   └── .revisions/         Previous skill documents
├── tools/                  Executable capabilities
├── memory/
│   └── history/            Saved conversations; never auto-resumed
├── development/
│   ├── docs/               Project documentation
│   ├── tests/              Development tests
│   ├── work/               Setup scratch files
│   └── tsconfig.json       TypeScript development checks
├── start.ps1               Windows launcher
├── bishop.cmd              Windows bishop command
├── install-command.ps1     Register this directory on user PATH
├── install.cmd             Windows installer launcher
├── install.ps1             Check prerequisites, install dependencies, register Bishop
├── INSTALLATION.md         GitHub-ready Windows installation instructions
├── package.json            npm commands and dependencies
└── AGENTS.md               Instructions for Codex development sessions
```

`node_modules/` is managed by npm. The existing Git repository is at this root.
Compact persistent facts live in `config/personality/memory.md` and load with
personality. `memory/history/` stores transcripts without loading them into the
model on restart. Explicit transcript search and SQLite memory retrieval are available.

## Edit Bishop

- [Settings](../../config/bishop.toml): model and individual tool switches.
- [Personality](../../config/personality/bishop.md): identity, voice, and judgment.
- [Soul](../../config/personality/soul.md): compact, evolving character shaped through
  [bishop-core-profiler](../../skills/bishop-core-profiler/SKILL.md).
- [Memory](../../config/personality/memory.md): compact facts carried between chats.
- [Harness instructions](../../config/harness.md): model-facing connection and tool-request protocol.
- [Compaction instructions](../../config/compaction.md): summaries of older exchanges
  when working context passes `[context] compact_at_characters` (default 400,000).
  Full transcripts remain intact; `/new` clears the in-process summary.
- [Skills](../../skills/): reusable procedures and supporting resources.

The harness keeps universal execution rules. Detailed web, memory, command, and
reading procedures live in optional [web-research](../../skills/web-research/SKILL.md),
[memory-use](../../skills/memory-use/SKILL.md),
[command-runner-use](../../skills/command-runner-use/SKILL.md), and
[reading-output](../../skills/reading-output/SKILL.md) skills. Routine tools remain
directly usable. [Compacted-context guidance](../../config/runtime/compacted.md) appears
only with a checkpoint; [decision-limit guidance](../../config/runtime/decision-limit.md)
appears only on the final request. Both load on startup without additional model calls.

The enabled-by-default apply_patch tool edits files directly using exact-context
patches, with compact results. Its tool definition includes a compact syntax
summary; [apply-patch-use](../../skills/apply-patch-use/SKILL.md) is the optional full
guide loaded when needed, rather than sent in every request. Disable it through
tools.apply_patch in the settings. Soul, memory, and skills use their dedicated tools.

Settings and harness instructions reload on launch. Personality Markdown also
refreshes before each model decision. Keep the
three placeholders in harness.md: instructions, tools, and conversation. They
insert current data; edit the surrounding wording to change its instructions.
Behavior lives in Markdown;
application code handles execution and permissions. Disabling a tool in config
both hides it and blocks execution.

Bishop may refine soul.md after meaningful personality feedback or a recurring
interaction pattern. The profiler consolidates redundancies rather than logging
each conversation. The whole soul stays under **2,000 characters**, including
headings and whitespace. `update_soul` requires the current profiler skill to be
loaded in the current turn, validates the limit, and applies accepted edits to
subsequent model requests. Set `tools.update_soul = false` to disable that tool.
The personality loader also rejects oversized soul files, including manual edits.
History remains separate and is not resumed when the app restarts.

## Memory

`config/personality/memory.md` is Bishop's small persistent notebook, initially
empty and kept under 4,000 Unicode characters including headings and whitespace.
It loads at startup and before each model decision, including after `/new`.
The conversation itself still starts empty on launch.

Tell Bishop "Remember that I prefer metric units", "Correct that preference to
imperial units", or "Forget my unit preference". The harness teaches him to use
`update_memory` with the complete replacement Markdown, preserving other useful
facts, consolidating entries, and confirming the tool's result. He may also save
clearly established practical facts useful in future chats, without logging every
exchange. Character stays in soul.md; procedures stay in skills.

Memory guidance excludes credentials, secrets, guesses, and temporary task status.
Saved facts are context, not authorization, and current corrections take precedence.
You can edit the file manually. Set `tools.update_memory = false` to disable the
dedicated writer; existing facts still load. This setting is not a filesystem
sandbox. Clearing memory does not erase saved transcripts. Broader retrieval is
still planned.

## Web search

Bishop can use `web_search` to search DuckDuckGo without an account or API key.
Restart Bishop after updating, then ask, for example, "Search the web for the
official Node.js documentation and give me the links."

The tool returns titles, destination URLs, and snippets, not full page content.
The harness instructs Bishop to cite sources with Markdown links. It uses DDG's
HTML search interface; bot challenges, rate limits, and unexpected page layouts
are reported as failures rather than empty results. No paid fallback is used.

In [settings](../../config/bishop.toml), `[search]` controls `result_limit` (default 5,
maximum 10) and `timeout_ms` (default 15000, maximum 60000). The only implemented
search provider is `duckduckgo`. Set `tools.web_search = false` to disable search.

## Web page reading

`web_read` reads public HTML and plain-text pages directly, without an account,
API key, or hosted service. Restart Bishop, then ask: "Read the official Node.js
file-system documentation and explain how to read a file, with a source link."

Results include readable text, title, final URL, content links, and truncation
evidence. Bishop can request another section with the returned `next_offset`.
Each section fetches the page again; extraction is heuristic and pages may change.
Scripts do not run and browser cookies are not used. JavaScript-only pages,
login walls, bot challenges, and unsupported formats such as PDF may fail visibly.

In [settings](../../config/bishop.toml), `[web_read]` controls timeout (default 15000 ms),
download cap (2000000 bytes), text per read (16000 UTF-16 units), and content
links (30). Set `tools.web_read = false` to hide and block the tool.

## Development

```sh
npm ci
npm test
npm run check
npm run demo
```

- [Full setup guide](../../development/docs/SETUP.md)
- [Architecture](../../development/docs/ARCHITECTURE.md)
- [Project decisions](../../development/docs/PROJECT.md)
- [Continuation notes](../../development/docs/HANDOFF.md)
- [Verification](../../development/docs/VERIFICATION.md)
