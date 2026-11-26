import { loadRules, withEmailRules } from "open-parcels-rules";
import { describe, expect, it } from "vitest";
import { AMAZON_EMAIL_RULES } from "../../src/carriers/amazon/email-rules.js";
import { createReturnInterpreter } from "../../src/mail/returns.js";
import type { MailInput } from "../../src/mail/types.js";

/*
 * Made-up return and refund mails. Their layout follows the shop's real mails (labelled lines,
 * links on their own line or in brackets); every name, number, address and link is invented.
 */
/** Amazon's return emails are read with the Amazon provider's email rules, as the inbox routes them. */
const interpret = createReturnInterpreter(
  withEmailRules(loadRules(), AMAZON_EMAIL_RULES),
  "Europe/Berlin",
);
const ORDER = "302-0000000-0000001";

function mail(partial: Partial<MailInput> & Pick<MailInput, "subject" | "text">): MailInput {
  return {
    messageId: null,
    from: '"rueckgabe@amazon.de" <rueckgabe@amazon.de>',
    html: null,
    authentication: null,
    date: new Date("2026-11-18T09:00:00Z"),
    ...partial,
  };
}

const REQUESTED_EN = [
  "Hello Example Person, Your return request is confirmed. Drop-off: You can drop off your return by Dec 2. Location: Any DHL Drop Off. Your refund will be issued after drop-off.",
  "Return code",
  `[Click here for Return Code](https://www.amazon.de/spr/returns/prep?rmaId=DExampleRMA1&orderId=${ORDER})`,
  "Your Return Summary",
  `Order #${ORDER}`,
  "Refund subtotal €24.99",
  "Total estimated refund* €24.99",
  "FREE return: You can return the item without any shipping charges.",
  "Drop off by:",
  "2. December 2026",
  "Drop-off Location",
  "DHL Drop off – no printer required",
  "Item(s) in your return request",
  "[Example headphones, black...](https://www.amazon.de/gp/product/B000000000)",
].join("\n");

const REQUESTED_DE = [
  "Hallo Example Person, Ihr Rücksendeantrag wurde bestätigt.",
  "Rücksendeetikett",
  `Etikett drucken (https://www.amazon.de/spr/returns/prep?rmaId=DExampleRMA2&orderId=${ORDER})`,
  "Zusammenfassung deiner Rückgabe",
  `Bestellnummer ${ORDER}`,
  "Gesamtbetrag Erstattung: 129,90 €^",
  "Rücksendekosten: 4,99 €",
  "Rückgabe bis:",
  "10. Dezember 2026",
  "Abgabestandort",
  "Abgabe in einer Packstation von DHL",
].join("\n");

describe("return mails", () => {
  it("reads a return request: deadline, drop-off, free return, label, refund and return id", () => {
    const [report] = interpret(
      mail({ subject: "Your return of Example headphones, black...", text: REQUESTED_EN }),
    );
    expect(report).toMatchObject({
      order: { shop: "amazon", orderNumber: ORDER },
      externalRef: "DExampleRMA1",
      status: "requested",
      returnBy: "2026-12-02",
      cost: { free: true, amount: null, currency: null },
      refund: { amount: 24.99, currency: "EUR", status: "pending" },
      items: ["Example headphones, black..."],
      mayCreate: true,
    });
    expect(report?.labelUrl).toMatch(/^https:\/\/www\.amazon\.de\/spr\/returns\/prep\?/);
    expect(report?.dropOff).toEqual([
      { carrier: "dhl", kind: "any", description: "Any DHL Drop Off" },
      { carrier: "dhl", kind: "shop", description: "DHL Drop off – no printer required" },
    ]);
  });

  it("reads a German request with a paid return to a parcel locker", () => {
    const [report] = interpret(
      mail({ subject: "Ihre Rücksendung von Beispiel-Lampe...", text: REQUESTED_DE }),
    );
    expect(report).toMatchObject({
      externalRef: "DExampleRMA2",
      status: "requested",
      returnBy: "2026-12-10",
      cost: { free: false, amount: 4.99, currency: "EUR" },
      refund: { amount: 129.9, currency: "EUR", status: "pending" },
      items: ["Beispiel-Lampe..."],
    });
    expect(report?.dropOff).toEqual([
      {
        carrier: "dhl",
        kind: "parcel_locker",
        description: "Abgabe in einer Packstation von DHL",
      },
    ]);
  });

  it("reads a drop-off confirmation as in transit", () => {
    const [report] = interpret(
      mail({
        subject: "Your return drop-off confirmation for Example headphones, black....",
        text: `Hello, Your return was dropped off. Your return is in-transit.\nOrder #${ORDER}`,
      }),
    );
    expect(report?.status).toBe("in_transit");
  });

  it("reads a refund as issued, and lets a refund for a return start one", () => {
    const [report] = interpret(
      mail({
        subject: "Your refund for Example headphones, black....",
        text: [
          "We've issued your refund for the item below. Your return is now complete.",
          `https://www.amazon.de/gp/your-account/order-details?orderID=${ORDER}`,
          "Refund total: EUR 24,99**",
        ].join("\n"),
      }),
    );
    expect(report).toMatchObject({
      status: "refunded",
      refund: { amount: 24.99, currency: "EUR", status: "issued" },
      mayCreate: true,
    });
  });

  it("reads the refund total of a German refund mail", () => {
    const [report] = interpret(
      mail({
        subject: "Ihre Erstattung für Beispiel-Lampe...",
        text: `Bestellnummer ${ORDER}\nDeine Erstattung wurde veranlasst.\nSumme der Rückerstattung 129,90 €^`,
      }),
    );
    expect(report?.refund).toEqual({ amount: 129.9, currency: "EUR", status: "issued" });
  });

  it("reads mails that are only HTML", () => {
    const [report] = interpret(
      mail({
        subject: "Your return of Example kettle...",
        text: null,
        html:
          `<html><body><p>Order #${ORDER}</p><table><tr><td>Return by:</td></tr>` +
          "<tr><td>2. December 2026</td></tr></table><div>FREE return</div></body></html>",
      }),
    );
    expect(report).toMatchObject({ returnBy: "2026-12-02", cost: { free: true } });
  });

  it("skips mails of other senders and mails without an order number", () => {
    expect(
      interpret(mail({ from: "news@shop.example.invalid", subject: "Your return", text: ORDER })),
    ).toEqual([]);
    expect(interpret(mail({ subject: "Your return of Example kettle...", text: "Hi" }))).toEqual(
      [],
    );
  });
});

describe("return emails of other shops and payment services", () => {
  const shared = createReturnInterpreter(loadRules(), "Europe/Berlin");

  it("files a shop's return email under the sender's domain and the subject's order", () => {
    const [report] = shared(
      mail({
        from: "Example Store <notice@store.example.com>",
        subject: "Return requested for order #3100042",
        text: "Your return request was sent and is being reviewed.\nItem: Example battery pack",
      }),
    );
    expect(report).toMatchObject({
      order: { shop: "store.example.com", orderNumber: "3100042" },
      status: "requested",
      items: ["Example battery pack"],
      mayCreate: true,
    });
  });

  it("matches a PayPal refund without a reference by the purchase total and the payee", () => {
    const [report] = shared(
      mail({
        from: '"service@paypal.de" <service@paypal.de>',
        subject: "Your refund from Example Market is on the way",
        text: [
          "Summary",
          "You originally paid Example Market 18,20 € EUR on 14 May 2026. View receipt",
          "Refund total",
          "4,62 € EUR",
        ].join("\n"),
      }),
    );
    expect(report).toMatchObject({
      order: {
        payee: "Example Market",
        total: { amount: 18.2, currency: "EUR" },
        paidBefore: "2026-11-18T09:00:00.000Z",
      },
      status: "refunded",
      refund: { amount: 4.62, currency: "EUR", status: "issued" },
      mayCreate: false,
    });
  });

  it("files a PayPal refund with the shop's invoice id under that reference", () => {
    const [report] = shared(
      mail({
        from: '"service@paypal.de" <service@paypal.de>',
        subject: "You have a refund from www.example-games.com",
        text: "Total purchase amount\n13,99 € EUR\nAmount refunded\n13,99 € EUR\nInvoice ID: 712345678901234567",
      }),
    );
    expect(report?.order).toEqual({ shop: "paypal", orderNumber: "712345678901234567" });
  });
});
