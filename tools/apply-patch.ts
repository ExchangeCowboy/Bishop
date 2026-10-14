import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolResult } from "../app/types.ts";

type Hunk = { before: string[]; after: string[]; eof: boolean };
type Edit = { path: string; operation: "add" | "update" | "delete"; lines: string[]; hunks: Hunk[] };
const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/;

function parsePatch(patch: string): Edit[] {
  if (patch.length > 100_000) throw new Error("Patch exceeds 100,000 characters; split it into focused edits.");
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.shift() !== "*** Begin Patch" || lines.pop() !== "*** End Patch") throw new Error("Patch requires *** Begin Patch and *** End Patch markers.");
  const edits: Edit[] = [];
  let i = 0;
  while (i < lines.length) {
    const match = header.exec(lines[i++]);
    if (!match) throw new Error("Expected *** Add File:, *** Update File:, or *** Delete File: header.");
    const edit: Edit = { path: match[2], operation: match[1].toLowerCase() as Edit["operation"], lines: [], hunks: [] };
    while (i < lines.length && !header.test(lines[i])) {
      if (edit.operation === "delete") throw new Error(`Delete File has no body: ${edit.path}.`);
      if (edit.operation === "add") {
        if (!lines[i].startsWith("+")) throw new Error(`Add File lines must start with +: ${edit.path}.`);
        edit.lines.push(lines[i++].slice(1));
        continue;
      }
      if (lines[i++] !== "@@") throw new Error(`Update File hunks begin with a bare @@: ${edit.path}.`);
      const hunk: Hunk = { before: [], after: [], eof: false };
      while (i < lines.length && lines[i] !== "@@" && !header.test(lines[i])) {
        const line = lines[i++];
        if (line === "*** End of File") { hunk.eof = true; break; }
        if (!/^[ +\-]/.test(line)) throw new Error(`Hunk lines need a space, +, or - prefix: ${edit.path}.`);
        if (line[0] !== "+") hunk.before.push(line.slice(1));
        if (line[0] !== "-") hunk.after.push(line.slice(1));
      }
      if (!hunk.before.length) throw new Error(`Update hunk needs existing context or removed lines: ${edit.path}.`);
      edit.hunks.push(hunk);
    }
    if (edit.operation === "update" && !edit.hunks.length) throw new Error(`Update File requires a hunk: ${edit.path}.`);
    edits.push(edit);
  }
  if (!edits.length || edits.length > 50) throw new Error("Patch must contain 1–50 files.");
  return edits;
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function canonicalPath(path: string): Promise<string> {
  let ancestor = resolve(path);
  const missing: string[] = [];
  while (true) {
    try { return resolve(await realpath(ancestor), ...missing); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(ancestor) === ancestor) throw error;
      missing.unshift(basename(ancestor)); ancestor = dirname(ancestor);
    }
  }
}

async function safeTarget(root: string, path: string): Promise<string> {
  if (!path.trim() || path.includes("\0")) throw new Error("Invalid patch path.");
  const target = resolve(root, path);
  if (target === root || !inside(root, target)) throw new Error(`Patch path is outside the working directory: ${path}.`);
  const parts = relative(root, target).split(sep);
  let current = root;
  for (const part of parts) {
    // Windows alternate streams and device names are not ordinary files.
    if (process.platform === "win32" && (part.includes(":") || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`Unsupported patch path: ${path}.`);
    current = resolve(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Patch path traverses a link: ${path}.`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
  }
  return target;
}

function updated(original: Buffer, edit: Edit): Buffer {
  const bom = original.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bom ? original.subarray(3) : original);
  if (text.includes("\0")) throw new Error(`Patch edits text files only: ${edit.path}.`);
  const crlf = text.includes("\r\n");
  if (text.replace(/\r\n/g, "").includes("\r") || (crlf && text.replace(/\r\n/g, "").includes("\n"))) throw new Error(`Mixed line endings need a separate explicit conversion: ${edit.path}.`);
  const normalized = text.replace(/\r\n/g, "\n");
  const newline = normalized.endsWith("\n");
  const lines = normalized ? normalized.split("\n") : [];
  if (newline) lines.pop();
  const output: string[] = [];
  let cursor = 0;
  for (const hunk of edit.hunks) {
    const matches: number[] = [];
    for (let i = cursor; i + hunk.before.length <= lines.length; i++) {
      if ((!hunk.eof || i + hunk.before.length === lines.length) && hunk.before.every((line, n) => line === lines[i + n])) matches.push(i);
    }
    if (matches.length !== 1) throw new Error(`${edit.path}: hunk matched ${matches.length} locations. Reread the relevant section and provide unique exact context.`);
    const start = matches[0];
    output.push(...lines.slice(cursor, start), ...hunk.after);
    cursor = start + hunk.before.length;
  }
  output.push(...lines.slice(cursor));
  return Buffer.from((bom ? "\uFEFF" : "") + output.join(crlf ? "\r\n" : "\n") + (newline && output.length ? (crlf ? "\r\n" : "\n") : ""), "utf8");
}

export async function applyPatch(patch: string, cwd: string, protectedPaths: string[] = []): Promise<ToolResult> {
  const files: { path: string; operation: Edit["operation"] }[] = [];
  let writing = false;
  try {
    const root = await realpath(cwd);
    const protectedTargets = await Promise.all(protectedPaths.map(canonicalPath));
    const plans: { edit: Edit; target: string; original?: Buffer; replacement?: Buffer; mode?: number }[] = [];
    const seen = new Set<string>();
    for (const edit of parsePatch(patch)) {
      const target = await safeTarget(root, edit.path);
      const key = process.platform === "win32" ? target.toLowerCase() : target;
      if (seen.has(key)) throw new Error(`Duplicate patch target: ${edit.path}.`);
      seen.add(key);
      if (protectedTargets.some(path => inside(path, target))) throw new Error(`Use the dedicated soul, memory, or skill tool for this target: ${edit.path}.`);
      let original: Buffer | undefined;
      try { original = await readFile(target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (edit.operation === "add" && original !== undefined) throw new Error(`Add File target already exists: ${edit.path}.`);
      if (edit.operation !== "add" && original === undefined) throw new Error(`Patch target does not exist: ${edit.path}.`);
      plans.push({ edit, target, original, mode: original === undefined ? undefined : (await lstat(target)).mode, replacement: edit.operation === "delete" ? undefined : edit.operation === "add" ? Buffer.from(edit.lines.length ? edit.lines.join("\n") + "\n" : "") : updated(original!, edit) });
    }
    // Every syntax/path/hunk check completes before the first write.
    writing = true;
    for (const { edit, target, original, replacement, mode } of plans) {
      await safeTarget(root, edit.path);
      if (original && !(await readFile(target)).equals(original)) throw new Error(`File changed during patch preparation: ${edit.path}.`);
      if (edit.operation === "delete") await rm(target);
      else {
        await mkdir(dirname(target), { recursive: true });
        if (edit.operation === "add") await writeFile(target, replacement!, { flag: "wx" });
        else {
          const temporary = `${target}.bishop-patch-${randomUUID()}.tmp`;
          try { await writeFile(temporary, replacement!, { flag: "wx", mode }); await rename(temporary, target); }
          finally { await rm(temporary, { force: true }); }
        }
      }
      files.push({ path: relative(root, target), operation: edit.operation });
    }
    return { ok: true, data: { files } };
  } catch (error) {
    return { ok: false, error: `${error instanceof Error ? error.message : String(error)}${writing ? " Inspect data.files and affected paths before retrying; write failures can leave partial changes." : " No files were changed."}`, data: { files } };
  }
}
