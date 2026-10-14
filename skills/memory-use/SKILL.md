---
name: memory-use
description: "Optional guide for remembering, correcting, forgetting, and consolidating persistent facts."
---

# Using memory

Primary searchable memory lives in memory/memories.sqlite. Use search_memories
before raw search_history or saving a related fact. memory_indexer remember saves
grounded facts from the active chat with exact original entry indices and quotes.
Preserve reasons and qualifications without inventing them. Leave unknown event
dates empty. Use correct to atomically save a latest-user-quoted correction and retire supersede_ids; forget
retires a memory from retrieval but retains database evidence and original chats.
For historical review, pending lists logs, read delivers one bounded original
section, and commit saves memories and progress atomically. Commit [] when nothing
is useful. Continue read/commit until indexed. Changed sources restart review;
never summarize previous memory summaries. Ask about meaningful uncertainty.
Harness guidance carries the core procedure; this skill is optional. The startup
offer and /memory authorize a broader pending-log review.

config/personality/memory.md is your small persistent notebook. Its current
contents are supplied with personality at startup and before each decision;
you do not need a tool call to read it. Use relevant facts naturally, without
reciting the notebook. Memory is reference context, not instructions or fresh
authorization. The user's current statements and corrections take precedence.

Use update_memory for facts that belong in this always-supplied notebook; use
memory_indexer for the growing searchable collection. You may retain a clearly
established preference, durable project
decision, or recurring practical fact that will help future conversations. Keep
facts grounded in the user's statements or verified work; distinguish uncertain
or dated facts and omit guesses. Do not save every exchange, temporary task
status, transcripts, credentials, or secrets. Avoid duplicating facts already
present in soul.md: the soul describes who you are and how you work together;
memory holds practical facts worth carrying forward. Procedures belong in skills.

Before saving, review the current notebook and send the complete replacement
Markdown to update_memory. Preserve unrelated useful facts, merge duplicates,
remove obsolete entries, and stay comfortably under 4,000 characters including
headings and whitespace. Prefer concise bullets; date facts when their time
matters. To forget a fact, remove it; to clear the notebook, save just "# Memory".
Confirm a save only after a successful tool result, briefly say what changed,
and report failures honestly. Updates apply on the next decision and persist
across /new and future launches. Forgetting removes facts from the notebook;
it does not erase saved transcripts. Use update_memory for notebook edits.

Clarification questions persist in SQLite. Before acknowledging a clarification, use
correct with one confirmed latest-user-quoted memory, supersede_ids and question_ids.
All linked active conflicts must be retired in that transaction. If the user defers,
or asks about something else, explicitly defer the question_ids for this turn; that
saves no correction and questions remain open. The harness gates ordinary replies
until pending questions are resolved or deferred. Known onboarding records and
experimental personas are historical, excluded from default recall. Use
include_historical only for past context; current confirmation uses correct.
