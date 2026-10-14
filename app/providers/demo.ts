import type { Action, Provider, ProviderInput } from "../types.ts";

/** Deterministic plumbing demo. This is not an AI model or a task interpreter. */
export class DemoProvider implements Provider {
  async next(input: ProviderInput): Promise<Action> {
    const last = input.history.at(-1);
    if (last?.role === "user") {
      return { kind: "tool", tool: "load_skill", arguments: { name: "command-runner-use" } };
    }
    const result = JSON.parse(last?.content ?? "{}") as { name?: string; ok?: boolean; data?: { stdout?: string }; error?: string };
    if (!result.ok) return { kind: "reply", message: `Demo stopped: ${result.error ?? "tool failed"}` };
    if (result.name === "load_skill" && input.tools.some(tool => tool.name === "run_command")) {
      return { kind: "tool", tool: "run_command", arguments: {
        goal: "check the command runner",
        command: process.platform === "win32" ? "Write-Output 'Bishop command runner works.'" : "printf '%s\\n' 'Bishop command runner works.'",
      } };
    }
    return { kind: "reply", message: result.data?.stdout?.trim() ?? "Offline demo: skill loaded successfully. The command runner is disabled by configuration." };
  }
}
