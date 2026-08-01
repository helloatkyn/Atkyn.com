import { TOKEN_LIMITS } from '../config/limits.js';

const CASUAL_RE  = /(?:^|\s)(kya haal hai|kya hal hai|kya haal|kya hal|aur kya haal|aur kya hal|aur kya|aur bata|aur bhai|aur yaar|kya scene|kya chal raha|kya chal|kya kar raha|kya ho raha|kaisa hai|kaisi hai|kaise ho|kaise hain|abay kaisa|abey kaisa|abay|abey|bhai kya|yaar kya|sun bhai|sun yaar|sab theek|sab thik|sab badhiya|chal kya|aaj kya|kya yaar|kya bhai|thak gaya|bore ho|mast hai|maza aa|kem cho|kem chho|ka haal ba|kasa kai|ram ram|wassup|what'?s up|wyd|hru|how r u|how are you doing|how have you been|what'?s good|what'?s new|bata kuch|kuch naya|kya hua|kya scene hai)(?:\s|$|[?!?,])/i;
const GREETING_RE = /^(hi+|hey+|hello|yo+|sup|hola|namaste|heya|howdy|gm|gn|good (morning|evening|night|afternoon)|salam|adaab|jai hind)[\s!?.]*$/i;

const plan = (intent, extra = {}) => ({
  intent,
  max_tokens: TOKEN_LIMITS[intent] ?? 160,
  ...extra,
});

export function planIntent(query) {
  const q  = query.trim();
  const ql = q.toLowerCase();
  const wc = q.split(/\s+/).length;

  // 0. Explicit verbosity escalation — user wants depth
  if (/\b(detail chahiye|elaborate|full explain|in depth|in-depth|comprehensive|deep dive|poora batao|step by step|sab kuch batao|detailed|explain fully|zyada detail)\b/i.test(ql))
    return plan('research', { directive: 'VERBOSITY ESCALATED by user request. Provide thorough, well-structured answer. Use ## headings where helpful. Stop when complete.' });

  if (GREETING_RE.test(q))
    return plan('greeting', { directive: 'Greeting mode. One warm sentence, stop.' });

  if (CASUAL_RE.test(ql) && wc <= 12)
    return plan('casual_chat', {
      temperature_override: 0.9,
      directive: 'CASUAL CHAT — HIGHEST PRIORITY. Reply like a close friend. MAX 1 sentence, MAX 18 words. NEVER define, translate, explain, list, or teach. Just reply and STOP.',
    });

  if (/[\d+\-*/^=]/.test(ql) && /\d/.test(ql) && wc <= 15)
    return plan('math', { directive: 'Math mode. Answer + minimal working. Stop.' });

  if (/\b(translate|translation|meaning in|how do you say|ka matlab kya|ka hindi|ka english)\b/.test(ql))
    return plan('translation', { directive: 'Translation mode. Give translation + 1 example if useful. Stop.' });

  if (/\b(research|deep dive|in depth|comprehensive|full analysis|detailed analysis|write an? (essay|article|report))\b/.test(ql))
    return plan('research', { directive: 'Research mode. Well-structured, use ## headings. Stop when complete.' });

  if (/\b(how to|tutorial|step by step|teach me|guide me|explain how|walkthrough)\b/.test(ql))
    return plan('tutorial', { directive: 'Tutorial mode. Numbered steps, concise. Skip obvious steps. Stop after last step.' });

  if (/\b(code|function|bug|error|fix|implement|write a|class|api|endpoint|query|sql|regex|script|loop|array|object|hook|component|flutter|dart|kotlin|python|javascript|typescript|react|node|css|html)\b/.test(ql))
    return plan('coding', { directive: 'Coding mode. Root cause → solution → clean code → short explanation only if non-obvious. No line-by-line. Stop.' });

  if (/\b(vs|versus|compare|difference between|which is better|pros and cons|contrast)\b/.test(ql))
    return plan('comparison', { directive: 'Comparison mode. Key differences only — table or bullets. No history unless asked. Stop.' });

  if (/\b(recommend|suggest|best|top|which should i|what should i use|advise)\b/.test(ql))
    return plan('recommendation', { directive: 'Recommendation mode. Direct pick + brief reason. No exhaustive list unless asked. Stop.' });

  if (/^who (is|was|are|were)\b/.test(ql))
    return plan('who_is', { directive: 'Who-is mode. Name, role, 1–2 key facts. No biography or timeline. Stop.' });

  if (/^what (is|are|was|were)\b/.test(ql) || /\b(define|definition of|meaning of|what does .+? mean)\b/.test(ql))
    return plan('definition', { directive: 'Definition mode. Concise definition + 1–2 facts. No history, competitors, or financials. Stop.' });

  if (wc <= 4 && !/[?]/.test(q) && /^[\w\s]+$/.test(q))
    return plan('entity', { directive: 'Entity mode. 1–2 sentence description + 1–2 facts. No history, timeline, financials, pros/cons, or competitors. Stop.' });

  if (/^(how|why|kaise|kyun|kyunki)\b/.test(ql))
    return plan('explanation', { directive: 'Explanation mode. Direct answer. Context only if it changes the answer. Stop.' });

  if (/\b(write a (poem|story|letter|email|song|joke|shayari)|creative|fiction|narrative)\b/.test(ql))
    return plan('creative', { directive: 'Creative mode. Match intent and style. Craft over length. Stop when complete.' });

  return plan('conversation', { directive: 'Conversation mode. Direct, natural, concise. Stop when answered.' });
}
