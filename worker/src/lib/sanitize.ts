/**
 * Strips raw HTML from Markdown description fields (spec §7.3) so stored
 * content can't carry script/XSS payloads into either the human UI or an
 * agent's context window.
 */
export function sanitizeDescription(input: string | null | undefined): string | null {
  if (input == null) return null;
  let text = input;
  text = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  text = text.replace(/<\/?[a-zA-Z!][^>]*>/g, '');
  text = text.replace(/\]\(\s*(javascript|data|vbscript):/gi, '](blocked:');
  return text;
}
