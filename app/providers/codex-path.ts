import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/** Discover native Codex installations without changing the user's PATH. */
export function findCodex(options: {
  env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform;
} = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const isFile = (path: string): boolean => {
    try { return statSync(path).isFile(); } catch { return false; }
  };
  if (env.BISHOP_CODEX_BIN) {
    const path = resolve(env.BISHOP_CODEX_BIN);
    if (!isFile(path)) throw new Error("BISHOP_CODEX_BIN does not point to a file. Set it to the Codex executable's full path.");
    if (platform === "win32" && /\.(cmd|bat)$/i.test(path)) {
      throw new Error("BISHOP_CODEX_BIN must point to codex.exe, not a .cmd or .bat launcher.");
    }
    return path;
  }
  const pathValue = env.PATH ?? env.Path ?? "";
  const filename = platform === "win32" ? "codex.exe" : "codex";
  for (const directory of pathValue.split(platform === "win32" ? ";" : ":")) {
    // Skip implicit current-directory entries rather than executing arbitrary files there.
    const clean = directory.replace(/^"|"$/g, "");
    if (!clean || !isAbsolute(clean)) continue;
    const candidate = join(clean, filename);
    if (isFile(candidate)) return candidate;
  }
  if (platform === "win32" && env.LOCALAPPDATA) {
    const root = join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
    if (existsSync(root)) {
      const candidates = readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => join(root, entry.name, "codex.exe"))
        .filter(isFile)
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      if (candidates[0]) return candidates[0];
    }
  }
  throw new Error("Bishop requires the Codex app or CLI. Install Codex and sign in with ChatGPT, then restart Bishop. If discovery fails, set BISHOP_CODEX_BIN to the executable's full path. Codex executable not found.");
}
