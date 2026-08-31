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

/** Alpha 2 model catalog. Browser text runtime prioritizes multilingual support. */
export const SMOL_MODELS = {
  primaryText: {
    id: "onnx-community/Qwen2.5-0.5B-Instruct",
    displayName: "Qwen2.5-0.5B-Instruct",
    kind: "text",
    role: "primary",
    toolCalling: false,
    reasoning: false,
    maxContext: 32_768,
    notes: "Primary multilingual browser text model. Search orchestration is handled by Alpha 2."
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
