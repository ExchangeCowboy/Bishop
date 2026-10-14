# Bishop Agent continuation notes

Updated October 14, 2026. Tim Williams built this.

## Current setup

The requested 0.12 alpha release uses package version 0.12.0-alpha and tag
v0.12.0-alpha. .github/workflows/release.yml packages committed files only, checks
the installer and clean defaults, produces a SHA-256 checksum, and publishes a
normal release marked Latest using the repository-scoped Actions token. It runs
when its workflow file is pushed to main or when manually dispatched. Existing
releases are promoted to normal/Latest without replacing their tag or assets.
Publication must be verified through the resulting release/run status.
Release notes are in [RELEASE_NOTES.md](../../RELEASE_NOTES.md).

Bishop 0.12 alpha was initially published as a prerelease on October 14, 2026.
The owner subsequently requested normal release visibility and Latest:
[release and downloads](https://github.com/ExchangeCowboy/Bishop/releases/tag/v0.12.0-alpha).
The tag points to ca9f5f05a32add9aac1c526c62c7ccdb815bafe2. The release job
completed successfully, with the Windows ZIP and checksum uploaded. Downloaded
ZIP checksum and all 80 file contents were verified against the tag. Local state
is excluded and heading-only soul/memory plus first_run=true remain in the package.

GitHub upload preparation targets the owner's existing public repository,
https://github.com/ExchangeCowboy/Bishop. The local codex/publish-bishop branch
starts from its existing main history. The owner's README, installation guide,
file map and existing MIT license are retained; the earlier local README is
linked as [REFERENCE.md](REFERENCE.md). The connected GitHub account has write
access. Publication uses the connector's tree/commit APIs and a leased update
of main, preserving its existing history and excluding ignored local state.

The project directory is the Git/npm root. Do not create a second app copy.
Read [PROJECT.md](PROJECT.md), [ARCHITECTURE.md](ARCHITECTURE.md), and
[SELF-DEVELOPMENT.md](SELF-DEVELOPMENT.md) before changing Bishop.

Codex is a prerequisite for normal use. Bishop discovers the installed Codex
app/CLI and checks ChatGPT login status before creating a session or starting
onboarding. No model call is needed for that check. The existing Codex login
handles authentication; Bishop has no separate account or OAuth enrollment.
API-key authentication is rejected. Offline demo and help bypass the prerequisite.
The provider model is unset by default so Codex selects its default.

The Windows installer is included: install.cmd launches install.ps1, which checks
Node.js 24+ and npm, discovers/verifies the existing Codex ChatGPT login, runs npm
ci --omit=dev, and registers this folder on user PATH. -NoPath skips registration.
It preserves local state and does not install Node/Codex or launch onboarding.
The dependency-free login helper in app/providers/codex-login.ts is shared by
installer and provider. [INSTALLATION.md](../../INSTALLATION.md) is the user guide.
All 129 tests, type checking, offline demo and fresh startup passed; actual
installation on a clean Windows machine remains untested.

Personal defaults have been reset: soul.md and memory.md contain only headings,
first_run is true, and no personal agent name is supplied by the base personality.
First-run personal-onboarding establishes the user's name, agent name, and purpose,
saves confirmed soul changes, then persists first_run=false. General voice and
judgment remain in bishop.md. Product/CLI branding remains Bishop Agent.

Old transcripts, SQLite memory and sidecars, skill revisions, the saved private
conversation report, and development scratch/backups were removed from the
project. Pre-cleanup recovery copies are private and outside the project in a
sibling BishopAgent-private-recovery directory; its timestamped folder contains
RECOVERY.md with direct restore instructions. Never include it in a release.
Earlier handoff details were replaced by this current summary because they
contained personal state and machine-specific paths.

## Implemented behavior

- Runtime/providers in app, tools in tools, editable Markdown/TOML in config,
  procedures in skills, development material in development.
- Every launch starts fresh conversation context. History is saved locally and
  retrieved explicitly; prior transcripts are never automatically replayed.
- Tools are enabled by default, with individual disable switches. Current skill
  delivery enforces configured prerequisites; ordinary commands need no skill.
- The Codex adapter requests one structured reply/tool decision per subprocess.
  Bishop executes tools and returns their evidence. Codex shell, hooks, plugins,
  and web search are disabled for these requests; user config is ignored.
- DuckDuckGo search and public HTML/plain-text page reading need no API key.
- Console activity, elapsed time, tool goals, token accounting, scrolling, /status,
  /usage, /help, /new, and /exit are implemented.
- Working-context compaction uses isolated tool-free model requests. Full original
  transcripts remain separate from the disposable model view.
- SQLite/FTS5 durable memory validates exact source quotes and commits progress
  atomically. Search supports historical/superseded facts. Clarification guards
  enforce correction or explicit deferral before replies.
- /memory and startup review deterministically orchestrate extraction, batching
  up to five source sections within 16,000 source characters. Retryable 429s have
  bounded delayed recovery; saved progress survives later failures. Development
  fixture labels are excluded by default without deleting sources.

## Verification and recovery

Run npm test, npm run check, and the offline demo after code changes. Use fake
providers and harmless commands; never reboot a machine as a test. Live inference
is not required for prerequisite checks. For startup checks, temporarily bypass
personal onboarding, restore first_run=true in finally, and remove generated
test state so shipped defaults remain untouched.

The cleanup's verification results are recorded in [VERIFICATION.md](VERIFICATION.md).
All 126 tests, npm run check, the offline demo, and fresh redirected startup
passed. Login status was checked without live inference. Config, personality,
harnesses, skill catalog, privacy scan, and 41 local documentation links validated.
Normal development backups remain under development/work and are Git-ignored;
privacy cleanup recovery is kept outside the project to avoid reintroducing data.
Restart Bishop after changing startup settings; personality refreshes each decision.

## Remaining scope

Independent provider connections, native Bishop sign-in, browser/desktop tools,
bundled/signed release packages, and licensing remain unimplemented or undecided.
Do not publish or choose a license without the owner's instruction.
