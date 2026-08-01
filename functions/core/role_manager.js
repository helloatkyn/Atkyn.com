const ROLE_ASSIGN_RE   = /\b(act as|you are|pretend to be|behave like|respond as|play the role of|be a|be an|imagine you are|assume the role of|from now on you are)\b/i;
const ROLE_CONTINUE_RE = /^(next|continue|go on|explain step|show another|one more|translate this too|same|and|also|furthermore|what about|another example|next question|next one|step \d)/i;
const ROLE_EXIT_RE     = /\b(sun meri baat|by the way|new topic|forget that|forget it|let's talk|help me|what is|who is|search this|different topic|change topic|nevermind|never mind|actually|unrelated|alag|chodo|chhodo|bhool jao)\b/i;

function extractRole(query) {
  const m = query.match(
    /(?:act as|you are|pretend to be|behave like|respond as|play the role of|be a|be an|imagine you are|assume the role of|from now on you are)\s+(?:a|an|the)?\s*(.+?)(?:\.|,|and|$)/i
  );
  return m ? m[1].trim() : null;
}

export function resolveRole(query, history) {
  const recent = Array.isArray(history) ? history.slice(-20) : [];

  if (ROLE_ASSIGN_RE.test(query))
    return { activeRole: extractRole(query), shouldClear: false, isNewAssignment: true };
  if (ROLE_EXIT_RE.test(query))
    return { activeRole: null, shouldClear: true, isNewAssignment: false };

  let detectedRole = null, roleIdx = -1;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].role === 'user' && ROLE_ASSIGN_RE.test(recent[i].content)) {
      detectedRole = extractRole(recent[i].content);
      roleIdx = i;
      break;
    }
  }
  if (!detectedRole) return { activeRole: null, shouldClear: false, isNewAssignment: false };

  const after = recent.slice(roleIdx + 1).filter(m => m.role === 'user');
  for (const m of after) {
    if (ROLE_EXIT_RE.test(m.content)) return { activeRole: null, shouldClear: true, isNewAssignment: false };
    if (!ROLE_CONTINUE_RE.test(m.content) && m.content.trim().split(/\s+/).length > 6)
      return { activeRole: null, shouldClear: true, isNewAssignment: false };
  }

  const wc = query.trim().split(/\s+/).length;
  if (!ROLE_CONTINUE_RE.test(query) && wc > 6)
    return { activeRole: null, shouldClear: true, isNewAssignment: false };

  return { activeRole: detectedRole, shouldClear: false, isNewAssignment: false };
}
