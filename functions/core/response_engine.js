import { SETTINGS } from '../config/settings.js';

export function buildRequestBody(messages, plan) {
  return {
    model: SETTINGS.model,
    messages,
    stream: true,
    max_tokens: plan.max_tokens,
    temperature: plan.temperature_override ?? SETTINGS.defaultTemperature,
    top_p: plan.temperature_override ? 0.95 : SETTINGS.defaultTopP,
    frequency_penalty: SETTINGS.frequencyPenalty,
    presence_penalty: SETTINGS.presencePenalty,
    // stop_sequences help short intents terminate cleanly without token waste
    ...(plan.stop_sequences ? { stop: plan.stop_sequences } : {}),
  };
}

