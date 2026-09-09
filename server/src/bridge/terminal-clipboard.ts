// Herdr rejects OSC 52 bodies above 256 KiB before emitting Clipboard.
const MAX_TERMINAL_CLIPBOARD_BASE64_CHARS = 256 * 1024;
const STANDARD_BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Validate the transport body; the browser additionally enforces UTF-8/text limits. */
export function isTerminalClipboardPayload(data: string): boolean {
  return (
    data.length > 0 &&
    data.length <= MAX_TERMINAL_CLIPBOARD_BASE64_CHARS &&
    STANDARD_BASE64_RE.test(data)
  );
}
