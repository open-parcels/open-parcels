import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_FAST_MS, LIVE_PROBE_MS, LiveTracker } from "../../src/engine/live.js";
import type { EphemeralMessage } from "../../src/events/bus.js";
import { RateLimitedError, TransientError } from "../../src/provider/api.js";
import { FakeWorld, fakeShop, reading, snapshot } from "../fakes/carriers.js";
import { createTestContext, type TestContext } from "../helpers.js";

/* Made-up coordinates far from anywhere real. */
const COURIER = { latitude: 10.5, longitude: 20.25 };

let context: TestContext;
let shop: FakeWorld;
let connectionId: string;
let positions: EphemeralMessage[];

beforeEach(async () => {
  shop = new FakeWorld();
  context = await createTestContext({ providers: [fakeShop(shop)] });
  connectionId = (
    await context.services.connections.create({
      provider: "fakeshop",
      kind: "shop",
      label: "Shop",
      config: {},
      secret: null,
    })
  ).id;
  positions = [];
  context.services.bus.subscribeEphemeral((message) => positions.push(message));
});
afterEach(async () => {
  await context.close();
});

async function poll(
  status: "in_transit" | "out_for_delivery" | "delivered",
  mapShown = false,
): Promise<string> {
  shop.listing = [
    snapshot({
      carrier: "fakeshop",
      trackingNumber: "SHOP-1",
      status,
      rawStatus: status,
      live: { ref: { trackingId: "made-up-1" }, mapShown },
    }),
  ];
  await context.services.connections.requestRun(connectionId);
  await context.services.scheduler.runDue();
  return (
    (await context.services.parcels.repository.list({ includeArchived: true }, false))[0]?.id ?? ""
  );
}

async function liveEvents(): Promise<Record<string, unknown>[]> {
  const rows = await context.services.db
    .selectFrom("outbox")
    .select(["type", "payload"])
    .where("type", "=", "parcel.live_updated")
    .orderBy("seq")
    .execute();
  return rows.map((row) => JSON.parse(row.payload) as Record<string, unknown>);
}

async function liveState(parcelId: string): Promise<string | undefined> {
  return (
    await context.services.db
      .selectFrom("live_state")
      .select("state")
      .where("parcel_id", "=", parcelId)
      .executeTakeFirst()
  )?.state;
}

describe("live courier tracking", () => {
  it("ends a session and clears its state when the connection stops offering the map", async () => {
    const parcelId = await poll("out_for_delivery", true);
    shop.liveScript = [reading("en_route", 4, COURIER)];
    await context.services.live.pass();
    expect(await liveState(parcelId)).toBe("en_route");

    // The next poll lists the parcel without a courier map.
    shop.listing = [
      snapshot({
        carrier: "fakeshop",
        trackingNumber: "SHOP-1",
        status: "in_transit",
        rawStatus: "in_transit",
        live: null,
      }),
    ];
    await context.services.connections.requestRun(connectionId);
    await context.services.scheduler.runDue();
    await vi.waitFor(async () => {
      expect(await liveState(parcelId)).toBeUndefined();
    });
    expect((await liveEvents()).map((event) => event["new_live_state"])).toEqual([
      "en_route",
      null,
    ]);
  });
  it("probes every five minutes while out for delivery without a map, then reads every 30 s", async () => {
    await poll("out_for_delivery");
    shop.liveScript = [null];
    expect(await context.services.live.pass()).toBe(LIVE_PROBE_MS);
    shop.liveScript = [reading("en_route", 12, COURIER)];
    expect(await context.services.live.pass()).toBe(LIVE_FAST_MS);
  });

  it("does not read parcels that are not out for delivery and show no map", async () => {
    await poll("in_transit");
    expect(await context.services.live.pass()).toBeNull();
    expect(shop.liveCalls).toHaveLength(0);
  });

  it("fires live_updated on start, state and stop changes, but never for a position alone", async () => {
    const parcelId = await poll("out_for_delivery", true);
    shop.liveScript = [
      reading("en_route", 12, COURIER),
      reading("en_route", 12, { latitude: 10.6, longitude: 20.3 }),
      reading("en_route", 13, COURIER),
      reading("next_stop", 0, COURIER),
    ];
    for (let pass = 0; pass < 4; pass += 1) {
      await context.services.live.pass();
    }
    const events = await liveEvents();
    expect(
      events.map((event) => [
        event["old_live_state"],
        event["new_live_state"],
        event["new_stops_away"],
      ]),
    ).toEqual([
      [null, "en_route", 12],
      ["en_route", "en_route", 13],
      ["en_route", "next_stop", 0],
    ]);
    expect(positions).toHaveLength(4);
    const parcel = await context.services.parcels.repository.get(parcelId);
    // The courier stays on the map until the delivery ends, the next stop included.
    expect(parcel?.live).toMatchObject({
      state: "next_stop",
      stops_away: 0,
      latitude: COURIER.latitude,
      longitude: COURIER.longitude,
    });
    // The message names its time in snake case like every other field, and only so.
    expect(positions.at(-1)?.payload).not.toHaveProperty("positionAt");
    expect(positions.at(-1)?.payload).toMatchObject({
      parcel_id: parcelId,
      position_at: "2026-11-18T14:00:00Z",
      stops_away: 0,
    });
  });

  it("never stores or emits coordinates in events or the database", async () => {
    await poll("out_for_delivery", true);
    shop.liveScript = [reading("en_route", 5, COURIER)];
    await context.services.live.pass();
    const outbox = await context.services.db.selectFrom("outbox").select("payload").execute();
    const liveRows = await context.services.db.selectFrom("live_state").selectAll().execute();
    const stored = JSON.stringify([outbox, liveRows]);
    expect(stored).not.toContain("10.5");
    expect(stored).not.toContain("20.25");
    // The API overlays the in-memory position while the courier is en route.
    const parcel = (await context.services.parcels.repository.list({}, false))[0];
    expect(parcel?.live).toMatchObject({
      latitude: COURIER.latitude,
      longitude: COURIER.longitude,
    });
  });

  it("asks for an immediate full poll when the session reports delivered", async () => {
    await poll("out_for_delivery", true);
    shop.liveScript = [reading("en_route", 1, COURIER), reading("delivered", 0)];
    await context.services.live.pass();
    context.clock.advance(30_000);
    await context.services.live.pass();
    const connection = await context.services.connections.get(connectionId);
    expect(Date.parse(connection?.nextRunAt ?? "")).toBeLessThanOrEqual(
      context.clock.now().getTime(),
    );

    shop.listing = [
      snapshot({
        carrier: "fakeshop",
        trackingNumber: "SHOP-1",
        status: "delivered",
        rawStatus: "Delivered",
      }),
    ];
    await context.services.scheduler.runDue();
    const types = (
      await context.services.db
        .selectFrom("outbox")
        .select("type")
        .where("type", "like", "parcel.%")
        .orderBy("seq")
        .execute()
    ).map((row) => row.type);
    expect(types.slice(-1)).toEqual(["parcel.delivered"]);
    expect(await context.services.live.pass()).toBeNull();
  });

  it("does not re-read an ended session while the parcel is still listed out for delivery", async () => {
    await poll("out_for_delivery", true);
    shop.liveScript = [reading("en_route", 1, COURIER), reading("ended", null)];
    await context.services.live.pass();
    await context.services.live.pass();
    await poll("out_for_delivery", false);
    shop.liveScript = [reading("ended", null)];
    expect(await context.services.live.pass()).toBeNull();
    expect((await liveEvents()).map((event) => event["new_live_state"])).toEqual([
      "en_route",
      "ended",
    ]);
  });

  it("stops after three failed passes until the next full poll, and honours Retry-After", async () => {
    await poll("out_for_delivery", true);
    shop.liveScript = [new RateLimitedError("slow", 120)];
    expect(await context.services.live.pass()).toBe(120_000);
    shop.liveScript = [new TransientError("x"), new TransientError("x")];
    await context.services.live.pass();
    await context.services.live.pass();
    expect(await context.services.live.pass()).toBeNull();
    expect(shop.liveCalls).toHaveLength(3);
    await poll("out_for_delivery", true);
    shop.liveScript = [reading("en_route", 3, COURIER)];
    expect(await context.services.live.pass()).toBe(LIVE_FAST_MS);
  });

  it("after a restart, lets only the connection following a session end it (OP-030)", async () => {
    const parcelId = await poll("out_for_delivery", true);
    shop.liveScript = [reading("en_route", 4, COURIER)];
    await context.services.live.pass();
    const other = await context.services.connections.create({
      provider: "fakeshop",
      kind: "shop",
      label: "Other shop",
      config: {},
      secret: null,
    });
    await context.services.db
      .insertInto("parcel_connections")
      .values({
        parcel_id: parcelId,
        connection_id: other.id,
        external_ref: null,
        role: "handoff",
        last_seen_at: context.clock.now().toISOString(),
      })
      .execute();
    // A tracker that starts empty, as after a restart.
    const { services } = context;
    const restarted = new LiveTracker({
      db: services.db,
      runner: services.runner,
      bus: services.bus,
      clock: services.clock,
      logger: services.logger,
      refreshConnection: () => Promise.resolve(),
      presentation: {
        position: () => undefined,
        imagePath: () => null,
        labelMode: () => services.settings.labelMode,
        timeZone: services.config.timeZone,
        providerName: (id) => id,
      },
    });
    restarted.setTargets(other.id, []);
    // Ending a session takes a few local database calls; give the other connection's run time.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await liveState(parcelId)).toBe("en_route");
    restarted.setTargets(connectionId, []);
    // The owning connection's empty run ends the session, once.
    await vi.waitFor(async () => {
      expect(await liveState(parcelId)).toBeUndefined();
    });
    expect((await liveEvents()).map((event) => event["new_live_state"])).toEqual([
      "en_route",
      null,
    ]);
  });

  it("forgets the target of a parcel deleted since the last poll", async () => {
    const parcelId = await poll("out_for_delivery", true);
    await context.services.db.deleteFrom("parcels").where("id", "=", parcelId).execute();
    expect(await context.services.live.pass()).toBeNull();
    expect(shop.liveCalls).toHaveLength(0);
  });
});

describe("the live tracking loop", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs one chain of passes however often it is woken during a pass", async () => {
    vi.useFakeTimers();
    const live = context.services.live;
    let release: (next: number | null) => void = () => undefined;
    const pass = vi.spyOn(live, "pass").mockImplementation(
      () =>
        new Promise<number | null>((resolve) => {
          release = resolve;
        }),
    );
    live.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(pass).toHaveBeenCalledTimes(1);
    // Wakes while the pass runs, as setTargets after every poll does.
    live.wake();
    live.wake();
    live.setTargets(connectionId, []);
    await vi.advanceTimersByTimeAsync(LIVE_FAST_MS);
    expect(pass).toHaveBeenCalledTimes(1);
    release(LIVE_FAST_MS);
    // One rerun for the wakes, right away, and nothing else.
    await vi.advanceTimersByTimeAsync(0);
    expect(pass).toHaveBeenCalledTimes(2);
    release(LIVE_FAST_MS);
    await vi.advanceTimersByTimeAsync(LIVE_FAST_MS - 1);
    expect(pass).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(pass).toHaveBeenCalledTimes(3);
    live.stop();
    release(LIVE_FAST_MS);
    await vi.advanceTimersByTimeAsync(LIVE_PROBE_MS);
    expect(pass).toHaveBeenCalledTimes(3);
  });
});
