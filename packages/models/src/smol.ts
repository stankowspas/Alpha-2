export type SmolModelKind = "text" | "vision-video";

export interface SmolModelDefinition {
  id: string;
  displayName: string;
  kind: SmolModelKind;
  role: "primary" | "optional";
  toolCalling: boolean;
  reasoning: boolean;
  maxContext?: number;
  notes: string;
}

/**
 * Alpha 2 model catalog.
 *
 * Keep this list intentionally small: only the Hugging Face Smol models
 * selected for the current Alpha 2 architecture belong here.
 */
export const SMOL_MODELS = {
  primaryText: {
    id: "HuggingFaceTB/SmolLM3-3B",
    displayName: "SmolLM3-3B",
    kind: "text",
    role: "primary",
    toolCalling: true,
    reasoning: true,
    maxContext: 128_000,
    notes: "Primary text/reasoning model. Supports think/no_think and tool calling."
  },
  vision: {
    id: "HuggingFaceTB/SmolVLM2-2.2B-Instruct",
    displayName: "SmolVLM2-2.2B-Instruct",
    kind: "vision-video",
    role: "optional",
    toolCalling: false,
    reasoning: false,
    notes: "Optional image/video understanding model."
  },
  visionLight: {
    id: "HuggingFaceTB/SmolVLM2-500M-Video-Instruct",
    displayName: "SmolVLM2-500M-Video-Instruct",
    kind: "vision-video",
    role: "optional",
    toolCalling: false,
    reasoning: false,
    notes: "Lighter optional video/vision model."
  },
  visionTiny: {
    id: "HuggingFaceTB/SmolVLM2-256M-Video-Instruct",
    displayName: "SmolVLM2-256M-Video-Instruct",
    kind: "vision-video",
    role: "optional",
    toolCalling: false,
    reasoning: false,
    notes: "Smallest optional video/vision model in the selected family."
  }
} as const satisfies Record<string, SmolModelDefinition>;

export const PRIMARY_MODEL = SMOL_MODELS.primaryText;
