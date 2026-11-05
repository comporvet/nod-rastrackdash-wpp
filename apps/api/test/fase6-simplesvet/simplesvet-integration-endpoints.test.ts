import { describe, expect, it } from "vitest";
import {
  jeanChannels,
  jeanLeads,
  W,
  world,
  type Rule,
} from "../fase5-url-unica/url-unica-world";

function simplesvetSale(input: { id?: string; phones?: string[] } = {}) {
  return {
    event: "sale.paid",
    sale: {
      id: input.id ?? "1234-20261014",
      paidAt: "2026-10-14T08:59:30-03:00",
      value: 400,
      phones: input.phones ?? ["11991231020"],
    },
  };
}

const rules: Rule[] = [
  {
    id: "simplesvet_global",
    provider: "simplesvet",
    eventName: "Purchase",
    scope: "all_numbers",
    connectionId: "conn_unnichat_a",
    channelIds: [],
  },
  {
    id: "yampi_global",
    provider: "yampi",
    eventName: "Purchase",
    scope: "all_numbers",
    connectionId: "conn_unnichat_a",
    channelIds: [],
  },
];

describe("SimplesVet on the single URL", () => {
  it("connects once as a sales platform", async () => {
    const w = world({ channels: jeanChannels, rules, leads: jeanLeads });
    const first = await w.connect("simplesvet");
    const second = await w.connect("simplesvet");
    expect(second.endpoint.id).toBe(first.endpoint.id);
    expect(first.endpoint).toMatchObject({
      provider: "simplesvet",
      kind: "sales_platform",
      eventName: null,
    });
    await expect(
      w.service.listUnattributed(W, "simplesvet"),
    ).resolves.toMatchObject({ total: 0 });
  });

  it("reaches the all-numbers rule from each number, never another platform's rule", async () => {
    const w = world({ channels: jeanChannels, rules, leads: jeanLeads });
    const { endpoint, token } = await w.connect("simplesvet");
    const first = await w.post(
      endpoint.id,
      token,
      simplesvetSale({ id: "a", phones: ["11991231020"] }),
    );
    const second = await w.post(
      endpoint.id,
      token,
      simplesvetSale({ id: "b", phones: ["5511987655520"] }),
    );
    expect(first).toMatchObject({ routing: "routed" });
    expect(second).toMatchObject({ routing: "routed" });
    expect(w.observed.map((call: any) => call.providerRuleId)).toEqual([
      "simplesvet_global",
      "simplesvet_global",
    ]);
    expect(w.observed[0].automation).toMatchObject({
      provider: "simplesvet",
      eventName: "Purchase",
      valueCents: 40000,
      currency: "BRL",
    });
  });

  it("finds the lead through a secondary phone of the tutor", async () => {
    const w = world({ channels: jeanChannels, rules, leads: jeanLeads });
    const { endpoint, token } = await w.connect("simplesvet");
    const result = await w.post(
      endpoint.id,
      token,
      simplesvetSale({ phones: ["4833330000", "11991231020"] }),
    );
    expect(result).toMatchObject({ routing: "routed" });
  });

  it("keeps a resent sale as one receipt and one delivery", async () => {
    const w = world({ channels: jeanChannels, rules, leads: jeanLeads });
    const { endpoint, token } = await w.connect("simplesvet");
    await w.post(endpoint.id, token, simplesvetSale());
    const resend = await w.post(endpoint.id, token, simplesvetSale());
    expect(resend).toMatchObject({ duplicate: true, routing: "routed" });
    expect(w.receipts.size).toBe(1);
    expect(w.deliveries.size).toBe(1);
  });

  it("lists a sale of someone who is not a lead as unattributed, never sent", async () => {
    const w = world({ channels: jeanChannels, rules, leads: jeanLeads });
    const { endpoint, token } = await w.connect("simplesvet");
    await w.post(
      endpoint.id,
      token,
      simplesvetSale({ phones: ["48999990000"] }),
    );
    expect(w.observed).toEqual([]);
    await expect(
      w.service.listUnattributed(W, "simplesvet"),
    ).resolves.toMatchObject({ total: 1 });
  });
});
