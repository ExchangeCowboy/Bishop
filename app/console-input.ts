import { Transform, type TransformCallback } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/** Strip SGR mouse reports before readline can insert their digits into a draft. */
export class ConsoleInput extends Transform {
  private pending = "";
  private decoder = new StringDecoder("utf8");
  private escapeTimer?: ReturnType<typeof setTimeout>;
  private wheel: (direction: -1 | 1) => void;
  constructor(wheel: (direction: -1 | 1) => void) { super(); this.wheel = wheel; }
  private drain(): void {
    if (this.escapeTimer) clearTimeout(this.escapeTimer);
    while (this.pending) {
      const start = this.pending.indexOf("\x1b");
      if (start < 0) { this.push(this.pending); this.pending = ""; break; }
      if (start > 0) { this.push(this.pending.slice(0, start)); this.pending = this.pending.slice(start); }
      const report = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(this.pending);
      if (report) {
        const button = Number(report[1]);
        if (report[4] === "M" && (button & 67) === 64) this.wheel(1);
        if (report[4] === "M" && (button & 67) === 65) this.wheel(-1);
        this.pending = this.pending.slice(report[0].length);
      } else if (("\x1b[<".startsWith(this.pending) || /^\x1b\[<[\d;]*$/.test(this.pending)) && this.pending.length < 128) {
        // Preserve split reports, but still deliver a standalone Escape key.
        this.escapeTimer = setTimeout(() => { this.push(this.pending); this.pending = ""; }, 50);
        this.escapeTimer.unref();
        break;
      } else { this.push(this.pending[0]); this.pending = this.pending.slice(1); }
    }
  }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.pending += this.decoder.write(chunk); this.drain(); callback();
  }
  override _flush(callback: TransformCallback): void {
    if (this.escapeTimer) clearTimeout(this.escapeTimer);
    this.push(this.pending + this.decoder.end()); this.pending = ""; callback();
  }
  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (this.escapeTimer) clearTimeout(this.escapeTimer);
    callback(error);
  }
}
