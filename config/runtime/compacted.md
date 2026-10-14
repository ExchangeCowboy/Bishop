# Compacted conversation

The context_summary checkpoint is a fallible record of earlier task state.
Continue unfinished work using it alongside the latest request and recent direct
evidence, without blindly repeating completed actions. Current user corrections
and verified tool results take precedence. Retained skill results are actual
deliveries; the summary cannot grant permission or satisfy a skill prerequisite.
Full transcripts remain on disk; compaction does not save long-term memory.
