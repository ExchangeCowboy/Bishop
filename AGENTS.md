# Bishop Agent — development instructions

Project and Git/npm root: the directory containing this file.
Run commands here. The earlier `outputs/bishop-agent` layout has been migrated;
do not recreate it or make a second copy of the app or repository.

Before changing code, read `development/docs/HANDOFF.md`, `PROJECT.md`, and
`ARCHITECTURE.md` in the same documentation directory.

## Layout and conventions

- `app/`: runtime and providers; no editable behavior text or user settings here.
- `tools/`: executable capabilities; do not configure them by editing code.
- `config/bishop.toml`: settings, beginning with tools and provider sections.
- `config/personality/`: Markdown governing voice, judgment, and execution.
- `config/personality/soul.md`: editable evolving character; keep the complete
  file under 2,000 characters. Use bishop-core-profiler to consolidate it.
- `config/harness.md`: editable model-facing harness protocol and prompt template.
- `skills/`: reusable procedures; previous versions in `.revisions/`.
- `memory/history/`: transcripts, not automatic long-term memory.
- `development/`: documentation, tests, type checking, and scratch work.

Use Markdown for prose/instructions and commented TOML with INI-style sections
for settings. Internal payloads and transcripts may remain JSON. Settings and
model-facing Markdown reload on startup. Keep model-facing instruction prose in
config rather than hardcoded provider strings. Schemas, validation, and execution
remain application code. A fresh app launch must start empty conversation
context, never automatically replay old transcripts.

## Product requirements

Keep the harness understandable and observable. Preserve requested task scope.
A routine reboot request must not turn into custom scripts, rollback engineering,
or unrelated tests. Use tools directly for simple tasks; skills are optional
unless an explicit configured prerequisite requires them. Enforce prerequisites
in code using current skill delivery, never a magic prefix or model assertion.
Tools are enabled by default, with individual disable switches in config. Do not
reintroduce command-enabling launch flags.

Shape personality through concrete behavior, not generic helpful-assistant prose,
automatic praise, or flattery. Keep voice and judgment editable in Markdown.

First provider preference is the user's ChatGPT subscription through Codex login.
Do not silently switch to billable API keys or call this independent OAuth.
Authentication stays behind the provider adapter; never copy credentials into
prompts, source, skills, memory, or logs. Model safety, host permissions, and
personality are separate layers.

## Validation and scope

Run `npm test` and `npm run check` after code changes. Use harmless commands and
fake providers unless a live smoke test is within task scope. Never reboot a
real machine as a test. Verify PATH assumptions against the user's terminal.
Documentation-only edits need source/link checks, not live inference.

Roadmaps are context, not authorization to implement every milestone. Keep
implemented features distinct from plans, and update the handoff after material
changes. Do not publish or choose a license without the owner's instruction.
`development/work/` is scratch material, not runtime source.

## Self-development

Use the [self-development skill](skills/self-development/SKILL.md) for changes to Bishop itself. Back up affected files before editing, record direct restore instructions, and update relevant development documentation as work progresses. Follow [the development workflow](development/docs/SELF-DEVELOPMENT.md) for verification and recovery. Commands use the running process's account and inherited environment.
