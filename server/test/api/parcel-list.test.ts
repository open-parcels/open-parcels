import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/api/app.js";
import { createTestContext, signIn, type TestContext } from "../helpers.js";

let context: TestContext;
let app: App;
let headers: Record<string, string>;

beforeEach(async () => {
  context = await createTestContext();
  app = await context.app();
  const session = await signIn(context, app);
  headers = { cookie: session.cookie, "x-csrf-token": session.csrf };
});
afterEach(async () => {
  await context.close();
});

interface Listed {
  readonly id: string;
  readonly display_name: string;
}

async function add(carrier: string, trackingNumber: string, label: string | null): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/parcels",
    headers,
    payload: { carrier, tracking_number: trackingNumber, label },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}

async function patch(id: string, body: Record<string, unknown>): Promise<void> {
  const response = await app.inject({
    method: "PATCH",
    url: `/api/v1/parcels/${id}`,
    headers,
    payload: body,
  });
  expect(response.statusCode).toBe(200);
}

async function names(query: string): Promise<string[]> {
  const response = await app.inject({ url: `/api/v1/parcels?${query}`, headers });
  expect(response.statusCode, query).toBe(200);
  return response.json<Listed[]>().map((parcel) => parcel.display_name);
}

describe("the parcel list in SQL", () => {
  it("searches every word, sorts by a column and pages the sorted list", async () => {
    const book = await add("dhl", "00340434161094000001", "Blue book");
    await add("hermes", "H0000000000000000001", "Red shoes");
    await add("dpd", "00000000000009", null);
    await patch(book, { manual_status: "delivered" });

    expect(await names("q=shoes")).toEqual(["Red shoes"]);
    expect(await names("q=BOOK%20blue")).toEqual(["Blue book"]);
    // "red" alone would match the status "delivered": a word of each parcel finds neither.
    expect(await names("q=book%20shoes")).toEqual([]);
    // The effective status and carrier are searched, and LIKE's own signs match only themselves.
    expect(await names("q=delivered")).toEqual(["Blue book"]);
    expect(await names("q=hermes")).toEqual(["Red shoes"]);
    expect(await names("q=%25")).toEqual([]);

    expect(await names("sort=name")).toEqual(["00000000000009", "Blue book", "Red shoes"]);
    expect(await names("sort=-name")).toEqual(["Red shoes", "Blue book", "00000000000009"]);
    expect(await names("sort=carrier&limit=2&offset=1")).toEqual(["00000000000009", "Red shoes"]);
    expect(await names("sort=-carrier&active=true")).toEqual(["Red shoes", "00000000000009"]);
    expect(await names("active=false")).toEqual(["Blue book"]);

    const bad = await app.inject({ url: "/api/v1/parcels?sort=tracking", headers });
    expect(bad.statusCode).toBe(400);
  });

  it("counts parcels on the way, delivered and archived, per carrier", async () => {
    const book = await add("dhl", "00340434161094000002", "Book");
    const lamp = await add("dhl", "00340434161094000003", "Lamp");
    await add("hermes", "H0000000000000000002", "Shoes");
    await patch(book, { manual_status: "delivered" });
    await patch(lamp, { archived: true });

    const response = await app.inject({ url: "/api/v1/parcels/counts", headers });
    expect(response.statusCode).toBe(200);
    const counts = response.json<Record<string, unknown>>();
    expect(counts).toMatchObject({
      active: 1,
      delivered: 1,
      archived: 1,
      carriers: [
        { carrier: "dhl", parcels: 2 },
        { carrier: "hermes", parcels: 1 },
      ],
    });
  });
});
