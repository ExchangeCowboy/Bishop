import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Entry } from "./types.ts";
import type { RunUsage } from "./usage.ts";

export class Sessions {
  directory: string;
  constructor(directory: string) { this.directory = directory; }
  async start(label: string): Promise<{ name: string; history: Entry[] }> {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(label)) throw new Error("Session label must contain 1–64 letters, numbers, underscores, or hyphens.");
    const name = `${label}-${randomUUID()}`;
    const history: Entry[] = [];
    await this.save(name, history);
    return { name, history };
  }
  path(name: string): string {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(name)) throw new Error("Session filename must contain 1–128 letters, numbers, underscores, or hyphens.");
    return join(this.directory, `${name}.json`);
  }
  async load(name: string): Promise<Entry[]> {
    try {
      const data: unknown = JSON.parse(await readFile(this.path(name), "utf8"));
      if (!Array.isArray(data) || !data.every(entry => entry && ["user", "assistant", "tool"].includes(entry.role) && typeof entry.content === "string")) {
        throw new Error("Invalid session file.");
      }
      return data as Entry[];
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  async save(name: string, history: Entry[], runs?: RunUsage[]): Promise<void> {
    const target = this.path(name);
    await mkdir(this.directory, { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(history, null, 2), "utf8");
    await rename(temporary, target);
    if (runs) {
      const metrics = target.replace(/\.json$/, ".usage.json");
      const pending = `${metrics}.${process.pid}.tmp`;
      await writeFile(pending, JSON.stringify({ version: 1, cachedInputIncludedInInput: true, runs }, null, 2), "utf8");
      await rename(pending, metrics);
    }
  }
}
