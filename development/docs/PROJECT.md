# Bishop Agent project brief

Started October 13, 2026. Tim Williams built this. Product name: Bishop Agent.

Current Codex project root: the directory containing package.json and AGENTS.md.
Application and Git root: the same directory.
See [HANDOFF.md](HANDOFF.md) for continuation context and
[ARCHITECTURE.md](ARCHITECTURE.md) for current implementation details.
See [OVERVIEW.md](OVERVIEW.md) for the founding goals and design philosophy
from the original **Bishop Agent** conversation.

## Purpose

Core operating principle: choose the simplest reliable solution that fulfills
the user's intent. Put in the work to understand the problem and solve it
completely. Keep steps, dependencies, and lasting changes proportionate to the
task. Each added layer should earn its place. This opens config/harness.md and
is included with every model request.

Build a personal replacement for Hermes with understandable code, observable
tool execution, and predictable task scope. A request to reboot a specified
machine should execute the appropriate authorized operation. It should not
silently expand into developing a script, rollback function, or unrelated tests.

## Architecture decisions

1. TypeScript is the implementation language; Node.js is the runtime; npm manages
   dependencies and eventual distribution. The core is portable, with OS-specific
   adapters for commands, desktop control, and credential storage.
2. The harness owns the loop: conversation -> model decision -> tool execution ->
   evidence returned to model -> reply or next action.
3. Tools are executable capabilities. Skills are reusable procedures, optionally
   containing scripts and references. The agent can use a tool directly.
4. Skill discovery sends names and short descriptions. Load full instructions
   only when relevant or when an operator-configured prerequisite requires them.
5. Enforced prerequisites belong in code. A skill hash and turn-scoped loading
   record prevent a remembered prefix from bypassing instruction delivery.
6. Self-improvement means creating and revising useful procedures from evidence.
   It does not mean changing model weights or performing RLHF.
7. First connection: owner's ChatGPT subscription through the official Codex
   runtime and existing login. The provider boundary allows later replacement.
8. Authentication, model policy, and host execution rules are distinct layers.
   A custom harness does not remove the model's learned safety behavior.
9. Tools are built in and enabled by default. The main `config/bishop.toml`
   starts with a `tools` section for manually disabling individual capabilities.
   Ordinary startup does not require a command-enabling flag.
10. Use Markdown for prose/instructions and commented TOML with INI-style sections
    for application settings. Internal structured payloads may remain JSON.
11. Every app launch starts a fresh conversation. Retain old transcript files for
    inspection without automatically reloading them into model context.
12. Separate runtime code (`app/`, `tools/`) from development (`development/`).
    Settings live in `config/`, behavior Markdown in `config/personality/`, skills
    in `skills/`, and transcripts in `memory/history/`. Root is the Git/npm root.

## First slice

Version 0.1.0 delivers chat, a host command runner, DuckDuckGo web search, direct web-page reading, compact persistent memory, a skill library, transcript
storage, automatic working-context compaction, an offline demo, and meaningful tests of execution and prerequisites.
Subscription access is mediated by Codex, not a new Bishop OAuth client.

The CLI backend returns a structured decision rather than executing Bishop tools
itself. Bishop passes tool definitions in the request and dispatches the returned
action. Codex's shell tool, hooks, plugins, and web search are disabled for that
invocation; its other runtime behavior and instructions still exist. This bridge
adds subprocess and context overhead and needs measurement against a direct
provider adapter. It is a practical first subscription integration, not the
final performance architecture.

## Next milestones

| Milestone | Completion evidence |
| --- | --- |
| Provider experience | Model selection, clear login status and limits, supported independent connection options |
| Search | DuckDuckGo query results, direct HTML/plain-text page reading, bounded continuation, and citation guidance implemented |
| Browser control | Observe a page, take an action, verify the resulting state |
| Desktop control | Equivalent observe/act/verify loop for one supported OS, then additional adapters |
| Memory and skills | Compact notebook, literal history search, SQLite full-text memory, resumable indexing with one isolated extraction call per section, startup review offer; semantic retrieval remains planned; skill revisions retained |
| Autonomy | Explicit job scope, cancellation, persistence and recovery without accidental action replay |
| Distribution | Reliable setup, documented requirements, testing on Windows/macOS/Linux |

## Evaluation

Compare Bishop and Hermes using the same model where possible and equivalent
task prompts. Measure task completion, elapsed time, input/output tokens, tool
calls, unnecessary skill loads, and unrequested actions. Include simple command
tasks, failed commands, searches, multi-step UI tasks, and corrections to skills.
Use simulations or disposable environments for disruptive operations.

Acceptance for the reboot example: correct target and authorization, direct
command, honest status, no invented backout workflow. Confirmation that the
machine is back online is a separate requested outcome when needed.

## Open decisions

Visual control library, additional search providers, UI beyond the CLI, memory retrieval
strategy, supported independent OAuth providers, public distribution, and license.
No license or publishing decision is implied by creating this project.
