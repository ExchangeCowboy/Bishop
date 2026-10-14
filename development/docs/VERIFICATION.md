# Verification — October 14, 2026

## Included Windows installer

All 129 tests and npm run check passed. Installer fixtures use temporary folders
with spaces and fake Node/npm commands; they verify success ordering, -NoPath,
missing Node/npm, old/invalid Node versions, login failure, npm failure, nonzero
exit status, and preservation of existing config. PATH registration is stubbed
in those tests, so no user registry changes or dependency downloads occur.
The fixture root is canonicalized to account for Windows short temporary paths.

The real installer correctly stopped with a missing-npm explanation in the
inherited development environment. The shared dependency-free login check passed
against the installed Codex using login status only. No live model call was sent.
Offline demo and fresh redirected startup/help/status/new/exit passed. First-run
defaults were restored and generated state moved to Git-ignored development scratch.
All 44 local documentation links validated. Official Node download, app setup,
and authentication links were checked for the installation guide.

An actual dependency installation and first-time PATH registration on a clean
Windows machine have not been tested. Node.js and Codex remain prerequisites;
install.ps1 installs Bishop's runtime dependencies, not those prerequisite apps.
Backup and restore manifest:
development/work/self-development-backups/20261014-120544-690/MANIFEST.md.

## Codex prerequisite and clean first-run defaults

Normal startup now checks the discovered Codex runtime's ChatGPT login before
session creation or onboarding. Fake prerequisite checks cover ChatGPT success,
API-key rejection, nonzero exit and timeout; credentials are not surfaced in
diagnostics. A CLI subprocess using Node as a rejecting executable verifies that
failed login leaves the config and saved-session inventory unchanged. A separate
missing-executable check also exited before writing a session.

All 126 tests and npm run check passed. npm was not on the inherited terminal
PATH; the existing temporary npm CLI was invoked through PATH-discovered Node
to run the project's test, check and demo scripts.

The installed Codex was discovered and its existing ChatGPT login verified with
login status only. No live inference was sent. The offline demo passed, preserving
first_run=true. A fresh redirected process received commands one prompt at a time
and passed /help, /status, /new and /exit. Personal onboarding was temporarily
bypassed for that check and the original config restored in finally. Sending all
commands in one initial stdin chunk lost later prompts; that check was replaced
by prompt-driven input without changing the console implementation.

The final config has first_run=true and no model override. Soul and notebook are
heading-only. Personality validation, required harness placeholders, and the
skill catalog passed. Onboarding behavior remains covered by fake-provider tests;
live onboarding quality was not tested. Old private state and verification-created
data were cleared after checks. Privacy searches found only the permitted builder
attribution in project source, documentation and config. Recovery copies are
private, outside the project; Git has no commits containing earlier personal state.

Earlier verification entries below describe historical runs, not shipped defaults.

## Saved conversation search

All 83 tests, npm run check, and offline demo passed using the existing temporary
npm CLI with PATH-discovered Node; npm itself remains absent from terminal PATH.
New fixture checks cover literal matching, case folding, source references,
pagination, session filtering, bounded excerpts, skipped corrupt/oversized files,
missing directories, invalid inputs, tool-record/usage exclusion, independent cwd,
disable switches, and fake-provider evidence delivery. Fresh sessions remain empty.
A read-only search of the actual local archive for "past conversations" scanned
127 valid transcripts, skipped none, found two matching entries, and returned one
bounded excerpt. Contents were not printed. This verifies local retrieval without
live inference; model use of the capability has only fake-provider verification.
A fresh redirected process loaded configuration/harness/personality, advertised
search_history among ten tools, reached the chat prompt, and exited via /exit
with code 0. No real reboot or live provider call was used. Project/architecture
and handoff documentation reflect implementation and remaining limitations.
Backup/restore: development/work/self-development-backups/20261014-084133-971/MANIFEST.md.

## Situational skill and runtime guidance

All 80 tests, npm run check, and offline demo passed using the existing temporary
npm CLI with PATH-discovered Node. A new regression verifies detailed procedures
are absent from ordinary rendered prompts but load through the skill dispatcher,
and missing/empty runtime guidance is rejected. Expanded compaction tests verify
guidance accompanies a checkpoint, survives reuse, leaves original history intact,
and disappears after reset. Expanded exhaustion tests verify the editable guide
is absent from normal instructions and present only on the final tools-disabled
request. Existing direct patch, memory, web, command, prerequisite, and final-tool
rejection tests still pass. No new model decision is required for runtime guidance.

Config, both templates, and both runtime files validated. A fresh redirected CLI
process reached the prompt and exited with code 0 without inference. All new skill
catalog entries load successfully; command-runner-use was revised through save_skill
with its previous document archived. Documentation links were checked locally.

Measured UTF-16 lengths: harness 7408 → 2993; controlled rendered request with
empty history and catalog-only instructions 11625 → 7769. The comparison includes
the three new catalog descriptions and updated tool definitions. Real requests
include personality/runtime facts and history. Loaded skills remain in history;
conditional runtime guidance is present only in the relevant states. Token counts,
live model compliance, and latency were not measured.
Backup and direct restore instructions:
development/work/self-development-backups/20261013-223413-342/MANIFEST.md.

## Optional patcher reference

All 79 tests, npm run check, and offline demo passed. A new fake-provider
regression verifies that the rendered normal request omits the detailed guide,
advertises its optional skill and compact syntax, then receives the guide after
load_skill and successfully patches a temporary file. The existing direct-patch
test still succeeds in one tool request with no skill or shell call.
Config and both harness templates validate, the new skill loads into the catalog,
and a fresh redirected CLI process reached its prompt and exited with code 0
without inference. Syntax links in README and ARCHITECTURE point to the new skill.

Measured UTF-16 lengths: harness 8499 → 7408; controlled rendered request with
tool specs and skill catalog 12229 → 11625. This comparison uses empty history
and catalog-only instructions on both sides, accounting for the new catalog
entry and compact tool syntax. Real requests also include personality/runtime
data and conversation history. Latency and token savings are unmeasured; a
skill load adds a model decision when Bishop chooses to request the guide.
Backup and direct restore instructions:
development/work/self-development-backups/20261013-222948-303/MANIFEST.md.

## Long reply history navigation

All 78 tests, npm run check, and offline demo passed using the existing temporary
npm CLI with PATH-discovered Node; npm itself is absent from terminal PATH.
Two regressions cover a 300-line reply, reaching the first/last lines, preserving
the viewport on new output and preserving a Unicode draft; SGR wheel/click packet
filtering, split reports, page-key forwarding, split UTF-8, standalone Escape,
and mouse-mode cleanup. An initial strip-only TypeScript syntax error was corrected
before all final checks passed.

A fresh native Windows PTY launched app/cli.ts, reached the pinned prompt,
ran /help, and retained `draft 漢字` while injected SGR wheel-up reports moved
the viewport three rows and Page Up reached the oldest text. Page Down and
wheel-down returned to the end; Ctrl+U cleared the draft, /exit completed with
code 0, and the output included mouse-mode disable sequences. No inference or
real machine operation was involved. Physical wheel behavior depends on SGR
mouse support; Shift + drag selection depends on the terminal. Page keys remain
the fallback. Terminal scrollback does not store the dock's full history.
Backup and direct restore instructions:
development/work/self-development-backups/20261013-205626-078/MANIFEST.md.

## Direct web-page reading

All 76 tests and npm run check passed. Six new tests cover config validation,
readable extraction/block/code boundaries, bounded/resolved links, redirects,
URL validation, text continuation, Unicode chunk boundaries, plaintext, HTTP
failures, unsupported formats, recognizable challenges, empty/script-only pages,
byte caps, network failures, connection/body timeouts, dispatcher evidence,
argument validation, and the disable switch. Fake fetch/provider fixtures perform
these tests without inference. The offline demo passed.

development/work/web-read-smoke.mjs performed a direct live read of
https://nodejs.org/api/fs.html: title "File system | Node.js v26.11.1 Documentation",
16000 returned characters of 247141 UTF-16 units, next_offset 16000, and 30 links.
It also loaded config and both harness templates and spawned a fresh redirected
Bishop process that reached the prompt, listed web_read through /status, and
exited through /exit without inference. Initial probe/test fixture mistakes were
corrected before these passing checks. No live model run or browser was required.

The existing temporary npm CLI ran npm test/check/demo via PATH-discovered Node;
npm is absent from this terminal PATH. @mozilla/readability, jsdom, and @types/jsdom
installed successfully, with zero vulnerabilities reported by npm's install audit.
JSDOM uses the 29.x release line to preserve Bishop's Node >=24.0.0 requirement;
every locked package's declared Node range was checked against 24.0.0. The final
dependency set passed all 76 tests, type checking, and the live/startup probe again.
Backup and direct restore instructions:
development/work/self-development-backups/20261013-194022-546/MANIFEST.md.

## White bishop console glyph

All 70 tests, npm run check, and offline demo passed using the existing temporary
npm CLI with PATH-discovered Node (npm itself is absent from this terminal PATH).
A disposable renderer check verified ♗ in the splash title and interactive reply
header, with every output row fitting 20, 40, and 80 columns. A fresh native
Windows PTY reached the chat prompt with the updated banner and exited cleanly
through /exit. No inference was needed. Backup and direct restore instructions:
development/work/self-development-backups/20261013-193530-505/MANIFEST.md.

## Three-line input and matching status color

All 70 tests, npm run check, and offline demo passed. Wrapping checks cover three
visible rows, longer drafts, exact-width cursor boundaries, wide Unicode glyphs,
cursor positions, reserved row placement, resize, and the matching bright cyan
status background. A fresh native Windows PTY showed a long Unicode draft across
all three input rows and exercised Home/End/clear and clean /exit without inference.
Backup: development/work/self-development-backups/20261013-190211-730/MANIFEST.md.

## Pinned input and session status

All 69 tests and npm run check passed; the offline demo passed. New tests cover
session token aggregation, unknown counts, abbreviated models/counts, narrow status
bars, Unicode input clipping/cursor placement, retained history paging, resize, and
cleanup. Native Windows PTY checks exercised /status, /usage, /new, /exit, long input
containing CJK and emoji, cursor movement/clearing, and Page Up/Page Down. Input
remained on the bottom row with status immediately above. A disposable fake-usage
probe exercised thinking/tool animation and sample token counts. No live inference
was needed. Backups and the probe are in
development/work/self-development-backups/20261013-184441-791/.

## Live terminal styling

All 66 tests and npm run check passed. Tests cover phase labels, one/two-row
layout at 8–140 columns, bounded long Unicode goals, TTY cursor movement and row
erasure, completed-only activity scrollback, palette output, and timer/row cleanup
after reply. Existing no-color/plain output and prior UI/tool/accounting checks
remain passing. The fake TTY test explicitly selects VT support and restores the
test environment afterward.
A native Windows PTY display check rendered the palette and real timer-driven
thinking/executing/compacting transitions, long goals, and final reply, then exited
cleanly. Its disposable script selects xterm VT support because this tool terminal
otherwise reports TERM=dumb. Offline demo and fresh prompt/exit passed. No model
requests, provider changes, or new dependencies were needed.

## Richer scrolling console

All 64 tests and npm run check passed. New layout tests verify single-row activity
at 2–140 columns, elapsed-time visibility when space permits, emoji/CJK/combining
text widths, narrow panel wrapping without lost tools/settings, numbered patch
activity, file summaries, token footer, unknown counts, and plain redirected replies.
Existing command goals, local status/usage, provider metrics, and execution tests
remain passing. The offline demo kept plain tool records with goals.

A native Windows PTY startup exercised /status, /usage, /help, /new, and /exit
without inference. A separate harmless PTY check rendered a long goal containing
emoji/CJK text while the indicator redrew in place, followed by its result and
reply. The deterministic renderer preview (console-preview.txt in the backup
folder) was inspected for complete startup fields, activity, reply/footer, and
usage. Preview values are illustrative. Terminal font width can vary; tests cover
common grapheme widths rather than every Unicode/font combination. No live model
requests or new dependencies were used.

## Per-run usage accounting

All 61 tests passed, including focused fake-provider checks for reported tokens,
invalid/missing counts, compaction correction calls, failed provider calls,
separate run records, sidecar persistence, reset, and console output. The exact
package-script entry points for npm test, npm run check, and the offline demo
ran successfully using the installed Node executable; npm was unavailable.
The saved demo sidecar was inspected: three decision calls, measured run/call
times, and null token counts rather than invented zeroes.

A fresh process displayed /usage and /help and exited cleanly through /exit.
Node substituted for the Codex executable, so any attempted inference would
have failed. The initial unpaced input probe lost queued lines and exited with
an unsettled-await warning; a second probe failed on shell quoting. The corrected
probe paced commands at each prompt and passed. No live model test was run.
Backup: development/work/self-development-backups/20261013-180523-554/MANIFEST.md.

## Local /status command

All 58 tests, the TypeScript check, and the offline demo passed. npm was
unavailable in the host environment, so validation ran the exact package script
entry points using the installed Node executable and local TypeScript compiler.
The focused test covers complete output, long working-directory paths, selected
models, no enabled tools, custom thresholds, and the /help entry.

A fresh chat displayed /status and /help with model and working-directory
overrides, then exited cleanly through /exit. Node was substituted for the Codex
executable: any model request would have failed. No provider request occurred.
The initial probe using a nonexistent executable failed startup discovery; the
corrected probe used an existing executable and passed. VERIFICATION.md's mixed
line endings were normalized to CRLF; its original remains in the backup.
Backup and restore manifest:
development/work/self-development-backups/20261013-175706-646/MANIFEST.md.

## 500k character context budget

All 57 tests and npm run check passed. The regression test verifies the 500000
guard, no compaction for a roughly 320k history, and automatic compaction above
400k while preserving recent evidence. Settings accept the new upper threshold
450000 and reject higher/invalid values; existing compaction, patching, and command
description tests pass. Tests use fake providers and harmless fixtures; the
provider's effective context window was not measured or inferred from this budget.
The offline demo displayed command goals and completed successfully. A fresh
normal chat reached its prompt and exited via /exit without model inference.

## Live host patch execution

After the user reported a false read-only blocker, config/harness.md clarified
the provider/host execution boundary. The saved run contained eight inspection
commands and no apply_patch attempt or write-permission failure.
A live smoke test used the current Codex adapter, configured model, and existing
ChatGPT login with only Bishop apply_patch enabled. The model requested one patch
that created sentinel.txt in a disposable temporary directory, then returned a
successful completion reply. The file's exact content was checked locally and
the verified temporary directory was removed. Elapsed time was 10.473 seconds,
with one tool call and no inspection or command execution. The adapter retained
its read-only sandbox and existing tool restrictions. Harness validation passed.
This verifies model-to-host editing, not a full self-development performance run.
The change is model-facing Markdown and documentation only; no runtime code or
dependencies changed and the existing 54-test suite was not rerun for these edits.

## Dedicated patch tool and efficient development

All 54 tests, npm run check, offline demo, and fresh prompt/exit passed. Six patch
tests cover add/update/delete, multiple hunks, EOF matching, ambiguous/stale hunk
rejection before any write, existing/missing/duplicate targets, malformed/oversized
patches, Unicode/BOM/CRLF/final-newline preservation, unsupported encoding,
permissions/config switches, invalid arguments, dedicated-target protection,
Windows short-path canonicalization, link traversal, temporary-file cleanup, and
completed-file evidence on a later write failure. A fake-provider agent edits
through one apply_patch request and receives compact evidence without run_command.
It also verifies exact Node runtime context is supplied. Existing full suite
checks tool discovery and execution switches for the expanded tool catalog.

The self-development skill was saved through save_skill with its previous revision
retained. Startup validated the edited harness and current skill catalog. These
checks use temporary fixtures and fake providers, not live model inference or a
performance benchmark. Future live turns can compare elapsed time, decisions,
inspection calls, and output volume; no token/speed improvement is claimed yet.

## Compaction summary correction

All 48 tests, npm run check, offline demo, and a fresh prompt/exit passed. New
fake-provider tests exercise recovery from oversized/empty/tool replies via one
tool-free correction, precise validation feedback, and stopping after two invalid
attempts with a specific diagnostic. Existing tests continue to prove checkpoint
preservation on provider failures. No live inference was used for this repair.
The user supplied live evidence of one successful compaction (93533 → 40146) and
a subsequent validation rejection. Its type/length cannot be recovered because
that reply was not logged. Deterministic repair tests do not prove summary quality.

## Automatic working-context compaction

All 46 tests and npm run check passed. New tests cover settings, bounded tool-free
batch summarization, retained latest user/skill/recent evidence, continuation beyond
the old full-history guard, a harmless command executed exactly once after
compaction with its prerequisite enforced, and complete transcript persistence.
They also cover repeated compaction, previous-checkpoint reuse, atomic rejection
of a failed later batch, empty/oversized/tool summary rejection, provider errors,
oversized latest requests, and fresh-chat reset. Tests use fake providers; summaries
are not assumed semantically faithful just because deterministic checks pass.

The actual failed console-label transcript was exercised read-only through a fake
summarizer: three summary requests reduced 130355 serialized transcript characters
to a 16212-character working input. Exact latest request, delivered skill, final
tool evidence, and the complete transcript were retained. Zero tools executed.
The offline demo and a fresh CLI chat reaching its prompt and exiting through
/exit passed. npm remains absent from this terminal's PATH; checks used its
existing temporary CLI with PATH-discovered Node. No live model inference ran.

## Targeted reading and explicit truncation

All 40 tests, npm run check, and npm run demo passed using the existing temporary
npm CLI with PATH-discovered Node. Output tests verify retained prefixes,
stdout/stderr total and omitted counts, exact-limit output without truncation,
nonzero exit evidence, and UTF-8 characters split across data chunks. A fresh
normal CLI process reached the chat prompt and exited through /exit with no model
request. Harness placeholders and skill catalog validation passed during startup;
self-development was saved through save_skill and its prior revision retained.
Guidance is editable Markdown; model reading efficiency has not been measured
in a live self-development turn. Full conversation compaction remains planned.

## Turn decision budget

All 38 tests and npm run check passed. Budget tests cover the default of 100,
custom settings and invalid values, early completion without an extra request,
the extra reply-only opportunity with final tool evidence, empty tool discovery,
and refusal to execute a further tool from an endlessly retrying provider.
Validation used fake providers and temporary fixtures without live inference.
The existing temporary npm CLI was invoked with the PATH-discovered bundled
Node because npm is absent from this Codex terminal's PATH.

## Compact memory

All 35 tests and npm run check passed. Two additional fixture tests exercise
atomic replacement and cleanup, Unicode character counting at the boundary,
rejected-draft preservation, newline normalization, unchanged writes, clearing,
manual oversized notebook rejection, failed writes, dispatcher argument/permission
checks, immediate next-decision refresh, recall in a fresh agent with empty
history, corrections, forgetting, and leaving soul.md untouched. Fake providers
and temporary files were used; the shipped notebook was not populated by tests.
The user subsequently reported that it works in actual use. No additional live
model test was run in this development chat. Model retention choices remain
guided by the editable harness rather than proven by deterministic tests.

## DuckDuckGo search

All 33 tests and npm run check passed. Five new tests cover configuration bounds,
HTML/entity and redirect decoding, ad exclusion, duplicate/invalid URL filtering,
result limits, permission and argument enforcement before network requests,
fake-provider evidence delivery, recognized empty results, malformed pages,
challenges, HTTP 202/403/429/500, unexpected content types, network failures,
the 1 MB body cap, and both connection and streamed-body timeout handling.

A direct live web_search("nodejs documentation") call returned five result
titles, destination URLs, and snippets from DDG. No live model inference was used.
This verifies current connectivity and parsing on this Windows machine, not
continued availability or resistance to future DDG page changes/bot challenges.
Cheerio was installed through npm with the lockfile updated; npm reported no
vulnerabilities. npm is still absent from this Codex terminal's PATH, so the
existing temporary npm CLI was invoked with the PATH-discovered bundled Node.

## Personal onboarding

All 28 tests and npm run check passed. New fixture tests cover boolean flag
validation, actual skill delivery before startup inference, continuation across
turns, soul persistence and next-decision refresh, comment/settings preservation,
current-version/current-turn completion prerequisites, failed saves remaining
pending, missing or disabled startup loading, and normal startup after completion.
The completion regression test reloads config into a fresh agent and verifies
that persisted first_run = false skips startup onboarding. The personality
directory contains only bishop.md and soul.md after setup; no profile is created.
No live provider or personal soul mutation was used for these tests.
The personal-onboarding skill passed quick_validate.py. Its PyYAML dependency
was installed in an OS temporary directory. The offline CLI demo passed with
the shipped first_run = true config, and its config hash stayed unchanged.
Checks used the existing temporary npm launcher because npm is absent from this
Codex terminal's PATH; project dependencies were unchanged.

Verified locally on Windows using Node.js 24.19.0 and the installed Codex CLI
0.162.0-alpha.17.2. Linux/macOS behavior has not been exercised.

- All 24 automated tests passed, including bounded soul editing and immediate refresh.
- TypeScript 5.9.3 strict checking passed with `tsc --noEmit`.
- npm validated the package lock with `install --package-lock-only --ignore-scripts`.
- The bundled command skill passed the skill-creator frontmatter validator.
- Offline demo loaded the skill and printed a fixed message through PowerShell.
- Live ChatGPT subscription smoke test replied: `Bishop Agent is online.`
- Live direct-tool test called `run_command` once, loaded no skill, printed a
  harmless message, and returned exit code 0.
- Live prerequisite test loaded `command-runner-use`, then called `run_command`
  once and returned exit code 0.
- After reproducing a missing Codex PATH entry, automatic desktop-executable
  discovery succeeded and a live subscription response completed normally.

Automated coverage includes direct command execution, required skill delivery,
turn-scoped loading, invalidation after skill edits, prior-version preservation,
disabled and unknown tools, argument validation, skill/session path traversal,
compact skill discovery, failed-command evidence, step limits, output limits,
process timeouts, malformed provider actions, and session persistence.

No reboot, remote administration, deployment, or external publication was used
for testing. Smoke-test transcripts are local ignored files under `memory/history/`.

These results demonstrate the chat/tool/skill loop and manual tool switches. They do not establish
long-run reliability, cross-platform parity, or performance relative to Hermes.

## Relocation check

After moving the workspace to `<project-root>`,
launcher help and all 14 automated tests passed from `.`.
This checked the moved code and development installation without live inference.

## Built-in tools and main configuration

The command runner now works on ordinary startup. `config/bishop.toml` supplies
manual tool switches with enabled defaults. All 16 tests and strict TypeScript
checking passed after this change. Coverage verifies every disabled tool is both
hidden from discovery and rejected by execution, omitted settings remain enabled,
and invalid configuration is rejected. The offline CLI demo printed its harmless
message without a command-enabling flag.

The moved development installation had a broken TypeScript link. `npm ci` restored
the dependencies from the existing lockfile, and type checking then completed.

## Provider model configuration

The provider section selects `gpt-6.1-sol` without a required launch flag. All 17
tests passed, including reading the model alongside tool switches and rejecting
invalid provider settings. Strict TypeScript checking passed.
A live one-shot launch without `--model` completed successfully using the
configured model and existing ChatGPT login.

## Readable settings

The commented TOML settings file retains the tool switches and selected model.
The config tests cover comments, a BOM, disabled tools, model selection, fallback
to an older JSON file, invalid types, duplicate settings, and malformed TOML.

## Fresh conversations at startup

All 19 tests and strict TypeScript checking passed. The regression test verifies
that relaunching with the same label starts empty, preserves older transcripts,
and sends only the new user message to the model. Two offline CLI launches using
the same label created distinct transcript files and completed successfully.

## Agreed directory layout and editable personality

The existing Git repository, application, configuration, skills, transcript files,
and development files were moved into the agreed root layout. npm test passed all
20 tests and npm run check passed from the project root. The new personality test
confirms edited Markdown reaches the model on the next launch and non-Markdown
files are not loaded. Personality text is no longer embedded in application code.

The root launcher completed an offline demo. A live ChatGPT subscription launch
used run_command directly to print a harmless message once, reporting exit code
0. Its new transcript was saved in memory/history. No disruptive operation was
performed. The existing Git directory was moved, not replaced or reinitialized.

## Console styling

npm test (20 tests) and npm run check passed. The offline demo preserved plain
one-shot output. A real terminal run displayed the startup panel, handled /help,
showed elapsed-time activity during a live brief reply, rendered the BISHOP
response, and closed cleanly with /exit. Styling added no runtime dependency.

## Editable harness Markdown

All 21 tests and npm run check passed. The regression test verifies that edited
harness instructions are rendered, JSON payloads remain intact, embedded
placeholder-like message text is not expanded, and invalid templates fail
clearly. The offline demo and a live brief ChatGPT reply both completed with
config/harness.md loaded at startup.

## Prompt cleanup

Removed duplicated simplicity/success rules, narrow reboot blacklists, vague
introductory wording, and static implementation explanations from personality.
The personality file now covers identity, voice, and judgment; the harness owns
execution principles and the response protocol. The actual shell is supplied as
runtime context. All 21 tests, npm run check, and both Markdown loaders passed.

## Compact soul and profiler skill

All 24 tests and npm run check passed; bishop-core-profiler passed the skill
validator. The soul starts at 146 characters. Tests verify strict limits,
rejection without overwriting the previous file, no-op handling, the profiler's
current-version/turn prerequisite, disabled-tool blocking, and next-decision
refresh of an accepted edit. A fixture-based model/tool loop exercised the
whole update sequence; the offline CLI demo and catalog discovery also passed.
No live soul rewrite was used as a test.

## Windows bishop command

`bishop` is registered on user PATH through install-command.ps1. Registration
was repeated to verify it does not duplicate the directory. Using only persisted
machine/user PATH (without Codex's injected Node path), bishop.cmd was discovered
from the temporary directory. `bishop chat --demo` executed the harmless offline
command, and `bishop chat` opened the console and exited on `/exit`. No live model
request was made. Both help forms and the original start.ps1 launcher passed;
unknown commands and extra command words returned exit code 1.

All 24 tests and TypeScript checking passed via `npm test` and `npm run check`.
This Codex environment has Node but no npm command, so checks used npm 11.6.2
downloaded into an OS temporary directory, without changing project dependencies
or installing npm globally.
