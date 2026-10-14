import { spawn } from "node:child_process";

export type ProcessResult = {
  stdout: string; stderr: string; exitCode: number | null;
  signal: string | null; timedOut: boolean; truncated: boolean;
  output?: { limit: number; stdout: { total: number; omitted: number }; stderr: { total: number; omitted: number } };
};

/** Launch an executable without constructing a shell command string. */
export function runProcess(executable: string, args: string[], options: {
  cwd: string; input?: string; timeoutMs?: number; outputLimit?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd, env: options.env ?? process.env,
      windowsHide: true, shell: false, stdio: "pipe",
    });
    let stdout = "", stderr = "", timedOut = false, truncated = false;
    let stdoutTotal = 0, stderrTotal = 0;
    const limit = options.outputLimit ?? 16_000;
    const collect = (current: string, chunk: string) => {
      const next = current + chunk;
      if (next.length > limit) truncated = true;
      return next.slice(0, limit);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdoutTotal += chunk.length; stdout = collect(stdout, chunk); });
    child.stderr.on("data", (chunk: string) => { stderrTotal += chunk.length; stderr = collect(stderr, chunk); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs ?? 30_000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, signal, timedOut, truncated,
        ...(truncated ? { output: { limit,
          stdout: { total: stdoutTotal, omitted: stdoutTotal - stdout.length },
          stderr: { total: stderrTotal, omitted: stderrTotal - stderr.length },
        } } : {}) });
    });
    // A process can exit before consuming stdin. Its exit status remains authoritative.
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
  });
}

export function shellCommand(command: string): { executable: string; args: string[] } {
  return process.platform === "win32"
    ? { executable: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command] }
    : { executable: "/bin/sh", args: ["-c", command] };
}
