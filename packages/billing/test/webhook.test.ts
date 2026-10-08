import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { verifyWebhook } from "../src/client.ts";

const SECRET = "whsec_test_secret";
const payload = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid", created: 1, data: { object: {} } });
const sign = (body: string, timestamp?: number) => Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET, timestamp });

describe("signature des webhooks Stripe", () => {
  it("accepte une signature valide", () => {
    expect(verifyWebhook(payload, sign(payload), SECRET).id).toBe("evt_1");
  });
  it("refuse une absence de signature, un corps modifié, un mauvais secret", () => {
    expect(() => verifyWebhook(payload, null, SECRET)).toThrow();
    expect(() => verifyWebhook(payload.replace("evt_1", "evt_2"), sign(payload), SECRET)).toThrow();
    expect(() => verifyWebhook(payload, sign(payload), "whsec_autre")).toThrow();
    expect(() => verifyWebhook(payload, "t=1,v1=abc", SECRET)).toThrow();
  });
  it("refuse un événement rejoué trop tard (tolérance d'horodatage)", () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(() => verifyWebhook(payload, sign(payload, old), SECRET)).toThrow();
  });
});
