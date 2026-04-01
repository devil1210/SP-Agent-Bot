// ─────────────────────────────────────────────────────────────────────────────
// COST TRACKER — Patrón SPcore-Nexus (UsageSummary + cost_tracker.py)
// Acumula tokens por turno y por sesión. Log automático en consola.
// ─────────────────────────────────────────────────────────────────────────────

export interface UsageSummary {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  provider: string;
  model: string;
}

export class CostTracker {
  private turns: UsageSummary[] = [];
  private readonly chatId: string;

  constructor(chatId: string) {
    this.chatId = chatId;
  }

  addTurn(usage: UsageSummary): void {
    this.turns.push(usage);
    console.log(
      `[Agent:Cost] 💰 Turn ${this.turns.length}: ` +
      `${usage.input_tokens}in / ${usage.output_tokens}out ` +
      `(${usage.total_tokens} total) — ${usage.provider}`
    );
  }

  get totalInputTokens(): number {
    return this.turns.reduce((sum, t) => sum + t.input_tokens, 0);
  }

  get totalOutputTokens(): number {
    return this.turns.reduce((sum, t) => sum + t.output_tokens, 0);
  }

  get totalTokens(): number {
    return this.totalInputTokens + this.totalOutputTokens;
  }

  get turnCount(): number {
    return this.turns.length;
  }

  summary(): string {
    return `[Cost] Chat ${this.chatId}: ${this.turnCount} turns, ` +
      `${this.totalInputTokens}in / ${this.totalOutputTokens}out = ${this.totalTokens} total`;
  }

  logFinal(): void {
    if (this.turns.length > 0) {
      console.log(`[Agent:Cost] 📊 ${this.summary()}`);
    }
  }
}
