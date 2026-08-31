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

/** Alpha 2 model catalog. Keep the browser text runtime intentionally lightweight. */
export const SMOL_MODELS = {
  primaryText: {
    id: "onnx-community/SmolLM2-360M-Instruct-ONNX",
    displayName: "SmolLM2-360M-Instruct",
    kind: "text",
    role: "primary",
    toolCalling: false,
    reasoning: false,
    maxContext: 8_192,
    notes: "Primary lightweight browser text model. Search orchestration is handled by Alpha 2, not by native model tool calling."
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
