# Bishop Agent purpose and design

Established October 13, 2026.

Bishop Agent is a personal replacement for Hermes, built around an existing
language model and a small, understandable harness. Its initial goals are chat,
computer use, and improvement through reusable skills. Web search, model
connections, persistent memory, and eventual autonomy extend that direction.
The user should be able to follow the logic, edit the behavior, and see what the
agent is doing.

The motivating problem is unnecessary task expansion. A request to reboot a
computer became script creation, backout logic, and tests; failure in that extra
work prevented the requested reboot. Extra steps also consumed tokens, slowed
responses, and made the experience frustrating. Bishop should complete the
requested outcome using a reliable approach proportionate to the task.

## Operating philosophy

The agreed core principle is:

> Choose the simplest reliable solution that fulfills the user's intent. Put in
> the work to understand the problem and solve it completely. Keep steps,
> dependencies, and lasting changes proportionate to the task. Each added layer
> should earn its place.

KISS means thoughtful simplicity and complete work. A small task should stay
small; a complex task deserves the work it actually requires. Dependencies,
preparation, and permanent changes need a reason grounded in the requested
outcome. This principle belongs in the harness and accompanies every model
decision.

The reboot example illustrates scope, rather than a special reboot policy.
Use the available authorized command and report its result. If access is missing,
identify that prerequisite. Creating domain accounts, granting administrator
rights, or changing infrastructure to force the reboot through would add lasting
changes outside that request. Similarly, importing several broad libraries for
a handful of small functions needs justification against a simpler implementation.

the user's concern about workarounds is this manufacture of missing prerequisites
and unnecessary complexity. Routine supported alternatives need no warning
ritual. Explain a material obstacle or compromise briefly when it affects the
outcome or requires a decision. Avoid repeated protective lectures and
unnecessary confirmation prompts.

Prefer positive instructions that describe the desired behavior. Specific
boundaries remain useful where needed, but a growing blacklist of examples
would obscure the general philosophy.

## How Bishop works

The model chooses a reply or a tool request. Ordinary software validates and
executes the request, captures evidence, and returns it to the model. Bishop
continues until it can reply or encounters a limit or error:

```text
User message -> model decision -> tool execution -> result -> next decision
```

Tools are executable capabilities, such as running a host command. Skills are
reusable procedures that explain how to achieve an outcome and check results;
they may include scripts and references. Bishop can call a tool directly for a
straightforward task. A skill is useful when its procedure is relevant, explicitly
requested, or required by configured execution rules.

The model receives a compact catalog of skill names and descriptions. Full
instructions load when needed, keeping unused procedures out of the context.
If loading a skill is mandatory, code checks that the current version was
delivered during the current turn. A remembered magic command prefix or a model
claim that it remembers the skill cannot substitute for that delivery. Delivery
alone does not prove compliance with every instruction.

Self-improvement means saving and revising useful procedures from experience
and corrections. It changes stored instructions, not model weights. Procedures
should preserve successful learning rather than accumulate unexamined mistakes.
The current skill system stores and versions documents; automatic validation
of their practical correctness remains future work.

## Behavior and configuration

| Location | Responsibility |
| --- | --- |
| `config/bishop.toml` | Application settings, model selection, and individual tool switches |
| `config/harness.md` | KISS, execution principles, tool/result protocol, and outcome reporting |
| `config/personality/bishop.md` | Identity, voice, and judgment |
| `config/personality/soul.md` | Compact enduring character refined through useful feedback |
| `skills/` | Reusable task procedures |

the user rejects canned helpful-assistant identity text, automatic praise, and
flattery. Shape character through concrete behavior: direct conversation,
independent judgment, candid correction, and attention to the user's intent.
Keep personality focused on character; put execution instructions in the
harness and implementation details in runtime context or tool definitions.
Merge duplicate instructions rather than growing overlapping prompt files.

The requested `bishop-core-profiler` skill lets Bishop refine `soul.md` after
meaningful personality feedback or stable interaction patterns. Keep it tidy,
consolidate redundant ideas, and avoid turning it into a transcript or a rule
for every interaction. The implementation interprets "under 2k" as fewer than
2,000 Unicode characters, including headings and whitespace. The dedicated
`update_soul` tool enforces that limit and requires the current profiler skill
to be loaded in the turn. Personality refreshes before each model decision;
settings and harness text reload on startup.

Use Markdown for prose and model-facing instructions, and commented TOML with
INI-style sections for settings. Schemas, validation, and executable permissions
remain code. Tools are enabled by default, with individual disable switches;
ordinary startup needs no command-enabling flag.

## Models and authentication

The harness instructions should remain model agnostic. Provider adapters handle
transport and authentication so another model connection can be added without
rewriting tools or personality.

the user chose his existing ChatGPT subscription as the first connection. Bishop
currently launches the installed Codex CLI using its existing ChatGPT sign-in.
It does not implement independent OAuth or copy login tokens into project
files. The configured model is `gpt-6.1-sol`. API keys, supported independent
OAuth connections, and local endpoints are possible later adapters, rather
than current implemented connection choices. A switch to billable API access
requires the owner's decision.

Model safety behavior, host execution permissions, and personality are separate
layers. A custom harness can change orchestration and instructions; it does not
remove behavior learned by the underlying model.

## Project structure and continuity

The project, Git, and npm root is
`<project-root>`. The earlier nested layout has been
migrated into this root.

Runtime and providers live in `app/`, executable capabilities in `tools/`,
configuration and personality in `config/`, reusable procedures in `skills/`,
and development docs, tests, and scratch work in `development/`. Skill revisions
live under `skills/.revisions/`.

Each app launch begins with empty conversation context. Old transcripts remain
in `memory/history/` for inspection and are never automatically replayed.
Persistent procedures and character can survive a restart without carrying the
whole previous conversation into every new session. Curated memory and retrieval
are still planned capabilities.

## Current capabilities and future scope

The first working slice uses TypeScript, Node.js, and npm. It provides CLI chat,
host command execution, skill discovery/loading/saving with revision retention,
configured skill prerequisites, transcript storage, an offline demo, and a
styled console with visible activity and tool outcomes. The compact soul and
profiler extend its editable personality.

Search, visual browser and desktop control, independent provider connections,
streamed replies, conversation compaction, curated memory, background autonomy,
and reliable process-tree cancellation remain future work. A portable core is
the direction; host commands, desktop integrations, and credential storage need
appropriate OS adapters and verification.

The initial aim is a useful personal agent. Broader competition should be judged
by equivalent tasks and models: completion, elapsed time, tokens, tool calls,
unnecessary skill loads, and unrequested actions. The original conversation
does not establish that Hermes's implementation is poorly engineered or that
Bishop already performs better. No public release or license has been chosen.
Roadmap entries provide context; each implementation task still needs scope.

## References

Origin: the Codex chat **Bishop Agent**, started October 13, 2026,
thread `01a13587-b487-7112-8c14-24f3abee2fa3`. This overview captures its founding
goals and subsequent decisions, including the soul/profiler request.

- [Project brief and roadmap](PROJECT.md)
- [Current architecture](ARCHITECTURE.md)
- [Continuation notes](HANDOFF.md)
- [Verification evidence](VERIFICATION.md)

Source code and the architecture/handoff documents determine current behavior
as implementation changes.
