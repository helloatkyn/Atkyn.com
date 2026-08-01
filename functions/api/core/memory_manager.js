import { SETTINGS } from '../config/settings.js';

export function getHistory(history) {
  return Array.isArray(history) ? history.slice(-SETTINGS.historyLimit) : [];
}
