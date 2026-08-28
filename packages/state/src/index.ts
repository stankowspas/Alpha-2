export type AppPhase = "BOOTING" | "READY" | "GENERATING" | "ERROR";

export interface AppState {
  phase: AppPhase;
  activeRequestId?: string;
  lastError?: string;
}

export class ApplicationStateManager {
  #state: AppState = { phase: "BOOTING" };

  get snapshot(): Readonly<AppState> {
    return { ...this.#state };
  }

  set(state: AppState): void {
    this.#state = { ...state };
  }
}
