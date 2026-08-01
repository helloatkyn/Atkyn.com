import { TOKEN_LIMITS } from '../config/limits.js';

export function getTokenBudget(intent) {
  return TOKEN_LIMITS[intent] ?? 160;
}

export { TOKEN_LIMITS };
