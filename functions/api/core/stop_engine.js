// Stop rules are enforced via max_tokens at API level.
// This module handles client-side heuristic checks if needed.
export function shouldStop(text, intent) {
  if (intent === 'casual_chat' && text.split(/\s+/).length >= 18) return true;
  return false;
}
