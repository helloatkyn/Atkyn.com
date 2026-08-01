export function detectLanguage(query) {
  if (/[\u0900-\u097F]/.test(query)) return 'hindi';
  if (/\b(hai|hain|kya|nahi|aur|bhi|toh|yaar|bhai|matlab|theek|haan)\b/i.test(query)) return 'hinglish';
  return 'english';
}
