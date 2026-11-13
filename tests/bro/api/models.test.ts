import { describe, expect, it } from "vitest";
import { selectAvailableModel, type ModelCatalog } from "@/bro/api/models";

describe("model selection refresh", () => {
  const catalog: ModelCatalog = {
    models: [
      { id: "codingbro-2.0", name: "Coding Bro", provider: "coding-bro" },
      { id: "gpt-6", name: "GPT-6", provider: "openai" },
    ],
    defaultModelId: "codingbro-2.0",
  };
  it("preserves a choice until the server removes it", () => {
    expect(selectAvailableModel(catalog, "gpt-6")).toBe("gpt-6");
    expect(selectAvailableModel(catalog, "removed")).toBe("codingbro-2.0");
    expect(
      selectAvailableModel({ models: [], defaultModelId: null }, "gpt-6"),
    ).toBeNull();
  });
});
