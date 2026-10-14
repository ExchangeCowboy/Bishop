import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { validateMemory } from "../app/memory.ts";

export async function updateMemory(file: string, draft: string): Promise<{ saved: boolean; characters: number }> {
  const content = draft.replace(/\r\n/g, "\n").trim() + "\n";
  const characters = validateMemory(content);
  const current = await readFile(file, "utf8").catch(error => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (current === content) return { saved: false, characters };
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
  return { saved: true, characters };
}
