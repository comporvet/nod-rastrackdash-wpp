import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  capabilitiesWithPayt,
  connections,
  numbers,
} from "./conversions-fixtures";
import { ruleOriginDefinition } from "../src/app/(app)/conversions/conversion-origins";
import { ruleEventLabelForOrigin } from "../src/app/(app)/conversions/event-copy";
import {
  buildRulePayload,
  emptyRuleDraft,
} from "../src/app/(app)/conversions/rule-draft";
import {
  integrationLogoPath,
  integrationProviders,
} from "../src/app/(app)/integrations/hub/integration-registry";
import {
  singleUrlPlatformLocatives,
  singleUrlPlatformNames,
  singleUrlSetupSteps,
  supportedEvents,
} from "../src/app/(app)/integrations/single-url/single-url-copy";

describe("SimplesVet in the panel", () => {
  it("is a card with its own logo and rule gate", () => {
    const card = integrationProviders.find(
      (provider) => provider.id === "simplesvet",
    );
    expect(card).toMatchObject({
      name: "SimplesVet",
      category: "attendance",
      gate: { kind: "simplesvet_rules" },
    });
    const logo = integrationLogoPath("simplesvet");
    expect(existsSync(resolve(__dirname, "../public", logo.slice(1)))).toBe(
      true,
    );
    expect(
      readFileSync(
        resolve(__dirname, "../public/integrations/SOURCES.md"),
        "utf8",
      ),
    ).toContain("`simplesvet.svg`");
  });

  it("offers only the paid sale", () => {
    expect(ruleOriginDefinition("automation_simplesvet").allowedEvents).toEqual(
      ["Purchase"],
    );
    expect(supportedEvents("simplesvet")).toEqual(["Purchase"]);
    expect(ruleEventLabelForOrigin("automation_simplesvet", "Purchase")).toBe(
      "Venda paga",
    );
  });

  it("builds a rule that receives only through the single URL", () => {
    const built = buildRulePayload(
      {
        ...emptyRuleDraft("automation_simplesvet"),
        name: "Venda SimplesVet",
        eventName: "Purchase",
        scope: "all_numbers",
      },
      {
        numbers,
        connections,
        capabilities: {
          ...capabilitiesWithPayt,
          origins: [
            ...capabilitiesWithPayt.origins,
            {
              origin: "automation_simplesvet",
              scopes: ["all_numbers", "specific_numbers"],
              channelProviders: ["uazapi"],
              authorChannelProviders: null,
              connectionBound: false,
              labelMatch: null,
              unifiable: false,
              eventNames: ["Purchase"],
              betaEventNames: [],
            },
          ],
        },
      },
    );
    expect(built).toMatchObject({
      ok: true,
      value: {
        triggerType: "provider_automation",
        eventName: "Purchase",
        automationSource: "simplesvet",
        perRuleUrl: false,
      },
    });
  });

  it("explains the n8n setup, never a platform screen", () => {
    expect(singleUrlPlatformNames.simplesvet).toBe("SimplesVet");
    expect(singleUrlPlatformLocatives.simplesvet).toBe("no SimplesVet");
    const steps = singleUrlSetupSteps("simplesvet").join(" ");
    expect(steps).toContain("n8n");
    expect(steps).toContain("credencial");
  });
});
