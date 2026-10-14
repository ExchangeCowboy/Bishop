import { tmpdir } from "node:os";
import { runProcess } from "../process.ts";

/** Dependency-free prerequisite check, also usable before npm installation. */
export async function requireChatGPTLogin(executable: string, execute = runProcess): Promise<void> {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  const status = await execute(executable, ["login", "status"], {
    cwd: tmpdir(), timeoutMs: 10_000, env,
  });
  if (status.timedOut || status.exitCode !== 0 || !/Logged in using ChatGPT/i.test(status.stdout + status.stderr)) {
    throw new Error("Bishop requires Codex signed in with ChatGPT. Open Codex and sign in, or run codex login, then restart Bishop. API-key authentication is not used by this adapter.");
  }
}
