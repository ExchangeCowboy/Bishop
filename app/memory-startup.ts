export function memoryStartupOffer(count: number, skipped: number): string | undefined {
  if (!count && !skipped) return undefined;
  const coverage = skipped ? ` ${skipped} chat log(s) could not be inspected; coverage is incomplete.` : "";
  return count ? `I have ${count} chat log${count === 1 ? "" : "s"} to review for memory. Should I do that now? [y/N]${coverage}`
    : `No readable chat logs are pending.${coverage}`;
}

export function acceptMemoryOffer(message: string): "accept" | "decline" | "chat" {
  if (/^(y|yes)$/i.test(message.trim())) return "accept";
  if (/^(n|no|later|not now)?$/i.test(message.trim())) return "decline";
  return "chat";
}
