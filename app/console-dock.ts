import { displayWidth, fitLine, wrapLines } from "./terminal-layout.ts";
import type { RunUsage } from "./usage.ts";

const at = (row: number, column = 1) => `\x1b[${row};${column}H`;
const erase = "\x1b[2K";
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function count(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}m` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export function sessionStatus(model: string, runs: RunUsage[], width: number): string {
  const calls = runs.flatMap(run => run.calls);
  const total = (key: "input" | "cachedInput" | "output") => {
    if (calls.some(call => call[key] === null)) return "?";
    const value = calls.reduce((sum, call) => sum + call[key]!, 0);
    return Number.isSafeInteger(value) ? count(value) : "?";
  };
  const short = model === "Codex default" ? "auto" : model.replace(/^gpt-/, "");
  const detailed = ` ${short}  │  IN ${total("input")}  │  CACHE ${total("cachedInput")}  │  OUT ${total("output")}`;
  const compact = ` ${fitLine(short, 10)} I:${total("input")} C:${total("cachedInput")} O:${total("output")}`;
  return fitLine(displayWidth(detailed) <= width ? detailed : compact, width);
}

export function inputViewport(text: string, cursor: number, width: number): { lines: string[]; cursor: number; cursorRow: number } {
  width = Math.max(2, width);
  cursor = Math.max(0, Math.min(cursor, text.length));
  const lines = [""];
  let row = 0, column = 0, cursorRow = 0, cursorColumn = 0;
  for (const part of graphemes.segment(text)) {
    const cells = displayWidth(part.segment);
    if (column + cells > width) { lines.push(""); row++; column = 0; }
    if (part.index <= cursor) { cursorRow = row; cursorColumn = column; }
    lines[row] += part.segment;
    column += cells;
    if (column === width) { lines.push(""); row++; column = 0; }
  }
  if (cursor === text.length) { cursorRow = row; cursorColumn = column; }
  const start = Math.max(0, cursorRow - 2);
  return { lines: lines.slice(start, start + 3), cursor: cursorColumn, cursorRow: cursorRow - start };
}

/** Retained history viewport, plus reserved activity/status/input rows. */
export class ConsoleDock {
  active = true;
  busy = false;
  history: string[] = [];
  offset = 0;
  input = "";
  cursor = 0;
  activity: string[] = [];
  rendered = new Map<number, string>();
  write: (text: string) => void;
  size: () => { columns: number; rows: number };
  status: (width: number) => string;
  color: () => boolean;
  constructor(write: (text: string) => void, size: () => { columns: number; rows: number },
    status: (width: number) => string, color: () => boolean) {
    this.write = write; this.size = size; this.status = status; this.color = color;
    this.write("\x1b[r\x1b[2J\x1b[H\x1b[?1000h\x1b[?1006h");
    this.resize();
  }
  private dimensions() {
    const { columns, rows } = this.size();
    const activity = rows >= 8 ? 2 : 0;
    return { columns, rows, activity, end: Math.max(1, rows - 4 - activity) };
  }
  print(text: string): void {
    if (!this.active) { this.write(text); return; }
    const before = this.offset ? this.historyLines().length : 0;
    this.history.push(...text.replace(/\r\n/g, "\n").split("\n").slice(0, -1));
    if (this.offset) this.offset += this.historyLines().length - before;
    this.redrawHistory();
  }
  private restoreCursor(): void {
    const { rows, columns } = this.dimensions();
    const visible = inputViewport(this.input, this.cursor, Math.max(2, columns - 9));
    this.write(at(rows - 2 + (this.busy ? 0 : visible.cursorRow), this.busy ? 1 : 9 + visible.cursor));
  }
  footer(): void {
    if (!this.active) return;
    const { rows, columns } = this.dimensions();
    const hint = this.offset ? ` ↑${this.offset} · PgDn / wheel ↓` : " · PgUp / wheel ↑";
    const status = fitLine(this.status(Math.max(1, columns - 1 - displayWidth(hint))) + hint, columns - 1);
    const padded = status + " ".repeat(Math.max(0, columns - 1 - displayWidth(status)));
    this.write(at(rows - 3) + erase + (this.color() ? `\x1b[106;30m${padded}\x1b[0m` : padded));
    const view = inputViewport(this.input, this.cursor, Math.max(2, columns - 9));
    const prompt = "  YOU › ";
    for (let i = 0; i < 3; i++) {
      const line = this.busy ? (i === 0 ? "  Working…" : "") : (i === 0 ? prompt : "        ") + (view.lines[i] ?? "");
      this.write(at(rows - 2 + i) + erase + (this.color() ? `\x1b[1;96m${line}\x1b[0m` : line));
    }
    this.restoreCursor();
  }
  setInput(text: string, cursor: number): void {
    this.input = text.replace(/[\x00-\x1f\x7f]/g, " "); this.cursor = cursor;
    this.footer();
  }
  setBusy(busy: boolean): void { this.busy = busy; this.footer(); }
  showActivity(lines: string[]): void {
    if (!this.active) return;
    this.activity = lines;
    const { end, activity } = this.dimensions();
    for (let i = 0; i < activity; i++) this.write(at(end + 1 + i) + erase + (lines[i] ?? ""));
    this.footer();
  }
  private redrawHistory(): void {
    const { end } = this.dimensions();
    const renderedHistory = this.historyLines();
    const until = Math.max(0, renderedHistory.length - this.offset);
    const lines = renderedHistory.slice(Math.max(0, until - end), until);
    for (let row = 1; row <= end; row++) {
      const text = lines[row - 1] ?? "";
      if (this.rendered.get(row) !== text) {
        this.write(at(row) + erase + text); this.rendered.set(row, text);
      }
    }
    this.showActivity(this.activity);
  }
  private historyLines(): string[] {
    const { columns } = this.dimensions();
    return this.history.flatMap(line => {
      const plain = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
      return displayWidth(plain) < columns ? [line] : wrapLines(plain, columns - 1);
    });
  }
  page(direction: -1 | 1): void {
    if (!this.active) return;
    const { end } = this.dimensions();
    this.scroll(direction * end);
  }
  scroll(lines: number): void {
    if (!this.active) return;
    const { end } = this.dimensions();
    this.offset = Math.max(0, Math.min(Math.max(0, this.historyLines().length - end), this.offset + lines));
    this.redrawHistory();
  }
  resize(): void {
    if (!this.active) return;
    const { rows, columns } = this.size();
    if (rows < 5 || columns < 18) { this.close(); return; }
    this.rendered.clear();
    this.write("\x1b[2J");
    this.redrawHistory();
  }
  close(): void {
    if (!this.active) return;
    const { rows, end } = this.dimensions();
    for (let row = end + 1; row <= rows; row++) this.write(at(row) + erase);
    this.write("\x1b[?1000l\x1b[?1006l\x1b[r" + at(rows));
    this.active = false;
  }
}
