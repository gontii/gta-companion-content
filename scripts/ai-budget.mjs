const INPUT_RATE = 26668 / 1_000_000;
const OUTPUT_RATE = 204805 / 1_000_000;
export const AI_DAILY_LIMIT = 8000;
const bytes = value => new TextEncoder().encode(value).length;
const cost = (input, output) => Math.ceil((input * INPUT_RATE + output * OUTPUT_RATE) * 1.1 + 50);

export function aiReservation(messages, maxTokens) {
  // A UTF-8 byte is a conservative upper bound for a byte-level tokenizer token.
  // Include the chat template separately; never guess actual usage from characters/4.
  const inputBound = bytes(JSON.stringify(messages)) + 256;
  return { inputBound, maxTokens, amount: cost(inputBound, maxTokens) };
}

export class AiBudget {
  constructor(storage, now = Date.now()) {
    this.storage = storage;
    this.day = new Date(now).toISOString().slice(0, 10);
    this.key = `ai-budget:${this.day}`;
  }
  async state() {
    return await this.storage.get(this.key) || { day: this.day, limit: AI_DAILY_LIMIT,
      measured: 0, safetyMargin: 0, estimated: 0, uncertain: (await this.storage.get(`ai:${this.day}`)) || 0,
      inFlight: 0, requests: 0, failed: 0 };
  }
  async reserve(messages, maxTokens) {
    const state = await this.state(), reservation = aiReservation(messages, maxTokens);
    if (state.measured + state.safetyMargin + state.estimated + state.uncertain + state.inFlight + reservation.amount > state.limit) {
      throw new Error('ai_local_budget_reserved');
    }
    state.inFlight += reservation.amount;
    state.requests++;
    const call = { ...reservation, id: crypto.randomUUID(), status: 'pending', createdAt: Date.now() };
    // One atomic storage write: a crash cannot lose the reservation or its identity.
    await this.storage.put({ [this.key]: state, [`ai-call:${this.day}:${call.id}`]: call });
    return call;
  }
  async settle(call, result, error = null) {
    const key = `ai-call:${this.day}:${call.id}`;
    const stored = await this.storage.get(key);
    if (!stored || stored.status !== 'pending') return;
    const state = await this.state(), usage = result?.usage;
    state.inFlight -= call.amount;
    const measured = Number.isInteger(usage?.prompt_tokens) && usage.prompt_tokens >= 0 &&
      Number.isInteger(usage?.completion_tokens) && usage.completion_tokens >= 0;
    const output = result?.response;
    let status, charged;
    if (measured) {
      status = 'measured'; charged = cost(usage.prompt_tokens, usage.completion_tokens);
      const neurons = Math.ceil(usage.prompt_tokens * INPUT_RATE + usage.completion_tokens * OUTPUT_RATE);
      state.measured += neurons;
      state.safetyMargin += charged - neurons;
    } else if (typeof output === 'string' || (output && typeof output === 'object')) {
      status = 'estimated';
      charged = cost(call.inputBound, Math.min(call.maxTokens, bytes(typeof output === 'string' ? output : JSON.stringify(output))));
      state.estimated += charged;
    } else {
      status = 'uncertain'; charged = call.amount;
      state.uncertain += charged;
    }
    if (error) state.failed++;
    await this.storage.put({ [this.key]: state, [key]: { ...stored, status, charged,
      settledAt: Date.now(), ...(measured ? { usage } : {}), ...(error ? { error: String(error.message).slice(0, 180) } : {}) } });
  }
}
