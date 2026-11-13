import type { AvailableModel, ModelCatalog } from "./types";

export const LITE_MODEL_REQUIREMENT =
  "仅支持 GPT 或已确认支持 OpenAI Responses 的兼容模型";

export function isGptModelId(modelId: string): boolean {
  return /^gpt-?\d[a-z0-9._-]*$/i.test(modelId);
}

export function supportsLiteCodex(model: AvailableModel | undefined): boolean {
  if (
    !model ||
    typeof model.id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model.id) ||
    model.responsesCompatible === false
  ) {
    return false;
  }
  if (model.provider === "openai") {
    return (
      isGptModelId(model.id) &&
      (model.apiFormat === undefined || model.apiFormat === "openai_responses")
    );
  }
  return (
    model.provider === "openai-compatible" &&
    model.apiFormat === "openai_responses"
  );
}

/** The product marker is server-owned and is never fabricated by filtering. */
export function liteModelCatalog(catalog: ModelCatalog): ModelCatalog {
  const models = catalog.models.filter(supportsLiteCodex);
  return {
    ...catalog,
    models,
    defaultModelId: models.some((model) => model.id === catalog.defaultModelId)
      ? catalog.defaultModelId
      : (models[0]?.id ?? null),
  };
}

/** Pass the filtered Lite catalog when selecting a Lite model. */
export function selectAvailableModel(
  catalog: ModelCatalog,
  previous: string | null,
): string | null {
  if (catalog.models.some((model) => model.id === previous)) return previous;
  if (catalog.models.some((model) => model.id === catalog.defaultModelId)) {
    return catalog.defaultModelId;
  }
  return catalog.models[0]?.id ?? null;
}
