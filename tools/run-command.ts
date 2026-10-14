import { runProcess, shellCommand } from "../app/process.ts";
import type { ToolResult } from "../app/types.ts";

export async function runCommand(command: string, cwd: string): Promise<ToolResult> {
  if (command.length > 16_000) throw new Error("Command exceeds 16,000 characters.");
  const invocation = shellCommand(command);
  const result = await runProcess(invocation.executable, invocation.args, { cwd });
  return { ok: result.exitCode === 0 && !result.timedOut, data: result,
    ...(result.timedOut ? { error: "Shell process timed out. Side effects may already have occurred; do not retry blindly." } : {}) };
}
