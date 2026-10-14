export type Arguments = Record<string, unknown>;
export type Entry = { role: "user" | "assistant" | "tool"; content: string; origin?: "memory_review" };
export type Action =
  | { kind: "reply"; message: string }
  | { kind: "tool"; tool: string; arguments: Arguments };
export type ToolResult = { ok: boolean; data?: unknown; error?: string };
export type ToolSpec = { name: string; description: string; parameters: unknown };
export type TokenUsage = { input: number | null; cachedInput: number | null; output: number | null };
export type ProviderInput = { instructions: string; history: readonly Entry[]; tools: ToolSpec[]; mode?: "compaction" | "memory" | "memory_batch"; onUsage?: (usage: TokenUsage) => void };
export interface Provider { next(input: ProviderInput): Promise<Action> }
export type Event = { type: "tool_requested" | "tool_result"; name: string; skillName?: string; goal?: string; result?: ToolResult }
  | { type: "context_compaction"; phase: "started" | "retrying" | "completed"; before: number; after?: number; detail?: string };
