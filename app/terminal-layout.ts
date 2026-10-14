const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function cells(grapheme: string): number {
  if (/^[\p{Mark}\u200d\ufe0f]+$/u.test(grapheme)) return 0;
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(grapheme)) return 2;
  const point = grapheme.codePointAt(0)!;
  return point >= 0x1100 && (point <= 0x115f || point === 0x2329 || point === 0x232a ||
    (point >= 0x2e80 && point <= 0xa4cf) || (point >= 0xac00 && point <= 0xd7a3) ||
    (point >= 0xf900 && point <= 0xfaff) || (point >= 0xfe10 && point <= 0xfe6f) ||
    (point >= 0xff01 && point <= 0xff60) || (point >= 0xffe0 && point <= 0xffe6) ||
    (point >= 0x20000 && point <= 0x3fffd)) ? 2 : 1;
}

export function displayWidth(text: string): number {
  return [...segments.segment(text)].reduce((sum, part) => sum + cells(part.segment), 0);
}

function prefix(text: string, width: number): string {
  let result = "", used = 0;
  for (const part of segments.segment(text)) {
    const size = cells(part.segment);
    if (used + size > width) break;
    result += part.segment; used += size;
  }
  return result;
}

export function fitLine(text: string, width: number): string {
  width = Math.max(0, Math.floor(width));
  if (displayWidth(text) <= width) return text;
  return width ? prefix(text, width - 1) + "…" : "";
}

export function wrapLines(text: string, width: number): string[] {
  width = Math.max(2, Math.floor(width));
  const result: string[] = [];
  for (const original of text.split("\n")) {
    let line = original;
    while (displayWidth(line) > width) {
      const part = prefix(line, width);
      const space = part.lastIndexOf(" ");
      const cut = space > 0 ? space : part.length;
      result.push(line.slice(0, cut));
      line = line.slice(cut).replace(/^ +/, "");
    }
    result.push(line);
  }
  return result;
}

/** Reserve the terminal's last cell to avoid automatic wrapping on redraw. */
export function activityLine(label: string, elapsed: string, frame: string, columns: number): string {
  const available = Math.max(0, columns - 1);
  const leading = `  ${frame} `, trailing = ` · ${elapsed}s`;
  if (displayWidth(leading + trailing) >= available) return fitLine(`${frame} ${elapsed}s`, available);
  return leading + fitLine(label, available - displayWidth(leading + trailing)) + trailing;
}

export function activityBlock(label: string, elapsed: string, tick: number, tools: number, columns: number): string[] {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const spinner = frames[tick % frames.length];
  if (columns < 42) return [activityLine(label, elapsed, spinner, columns)];
  const phase = label.startsWith("Running") ? "EXECUTING" : label.startsWith("Compacting") ? "COMPACTING" : "THINKING";
  const rail = Array.from({ length: 8 }, (_, i) => i === tick % 8 || i === (tick + 1) % 8 ? "━" : "·").join("");
  return [
    activityLine(`${phase}  ${rail}  ${tools} tool${tools === 1 ? "" : "s"}`, elapsed, spinner, columns),
    fitLine(`    └─ ${label}`, columns - 1),
  ];
}
