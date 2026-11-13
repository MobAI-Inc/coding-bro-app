export interface AvailableModel {
  id: string;
  name: string;
  provider: "coding-bro" | "openai" | "anthropic";
  walletPricing?: {
    inputMicroUsdPerMillionTokens: string;
    outputMicroUsdPerMillionTokens: string;
    longInputMicroUsdPerMillionTokens: string;
    longOutputMicroUsdPerMillionTokens: string;
  };
  subscriptionEligible?: boolean;
  billingSource?: "subscription_then_balance" | "balance";
}

export interface ModelCatalog {
  models: AvailableModel[];
  defaultModelId: string | null;
}

export function selectAvailableModel(
  catalog: ModelCatalog,
  previous: string | null,
): string | null {
  if (catalog.models.some((model) => model.id === previous)) return previous;
  if (catalog.models.some((model) => model.id === catalog.defaultModelId))
    return catalog.defaultModelId;
  return catalog.models[0]?.id ?? null;
}
