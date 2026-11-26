import { z } from "zod";
import { DIRECTIONS, parcelSchema, parcelStatusSchema } from "../../domain/parcel.js";
import { detectCarrier } from "../../engine/detect.js";
import {
  PARCEL_PAGE_DEFAULT,
  PARCEL_SORT_KEYS,
  parcelCounts,
  type ParcelSortKey,
} from "../../parcels/list-query.js";
import { DuplicateParcelError } from "../../parcels/service.js";
import type { Services } from "../../services.js";
import type { TypedApp } from "../app.js";
import { requireScope } from "../auth-plugin.js";
import { fallbackCarrier } from "../../engine/fallback.js";
import { ApiError, errorBodySchema, notFound } from "../errors.js";
import { idParams, markNextPage, pageQuery } from "../schemas.js";

const trackingNumberField = z.string().trim().min(4).max(64);

const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");

/** `name` sorts ascending, `-name` descending. */
const sortQuery = z
  .enum([...PARCEL_SORT_KEYS, ...PARCEL_SORT_KEYS.map((key) => `-${key}` as const)])
  .transform((value) => ({
    key: value.replace(/^-/, "") as ParcelSortKey,
    desc: value.startsWith("-"),
  }));

const countSchema = z.number().int().nonnegative();

export function registerParcelRoutes(app: TypedApp, services: Services): void {
  const read = requireScope("read");
  const write = requireScope("write");

  app.get(
    "/api/v1/parcels",
    {
      preHandler: read,
      schema: {
        tags: ["parcels"],
        summary: "List parcels, newest change first.",
        description:
          "Pages of `limit` parcels (default 500), from `offset`. A full page carries the " +
          "`X-Next-Offset` header with the offset of the next page; the last page has none. " +
          "`q` keeps parcels in which every word appears in the tracking number, label, " +
          "carrier, status, the carrier's status text, an item name, or the order's shop, " +
          "number or name. `sort` (default `-updated_at`): `updated_at`, `name` (label, else " +
          "item names in that label mode, else tracking number), `status`, `lookup`, " +
          "`carrier` or `expected`; a leading `-` sorts descending, parcels without a value " +
          "come last.",
        querystring: z.object({
          active: booleanQuery.optional(),
          status: parcelStatusSchema.optional(),
          carrier: z.string().max(64).optional(),
          include_archived: booleanQuery.optional(),
          include_history: booleanQuery.optional(),
          q: z.string().max(200).optional(),
          sort: sortQuery.optional(),
          ...pageQuery(1000),
        }),
        response: { 200: z.array(parcelSchema) },
      },
    },
    async (request, reply) => {
      const query = request.query;
      const limit = query.limit ?? PARCEL_PAGE_DEFAULT;
      const offset = query.offset ?? 0;
      const parcels = await services.parcels.repository.list(
        {
          ...(query.active === undefined ? {} : { active: query.active }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.carrier === undefined ? {} : { carrier: query.carrier }),
          ...(query.include_archived === undefined
            ? {}
            : { includeArchived: query.include_archived }),
          ...(query.q === undefined ? {} : { search: query.q }),
          ...(query.sort === undefined ? {} : { sort: query.sort }),
          // One more than asked tells whether another page follows.
          limit: limit + 1,
          offset,
        },
        query.include_history === true,
      );
      markNextPage(reply, offset, limit, parcels.length > limit);
      return parcels.slice(0, limit);
    },
  );

  registerParcelCountRoute(app, services);

  app.get(
    "/api/v1/parcels/:id",
    {
      preHandler: read,
      schema: {
        tags: ["parcels"],
        summary: "One parcel with its full history.",
        params: idParams,
        response: { 200: parcelSchema, 404: errorBodySchema },
      },
    },
    async (request) => {
      const parcel = await services.parcels.repository.getVisible(request.params.id);
      if (parcel === undefined) {
        throw notFound("parcel");
      }
      return parcel;
    },
  );

  app.post(
    "/api/v1/parcels",
    {
      preHandler: write,
      schema: {
        tags: ["parcels"],
        summary:
          "Start tracking a tracking number. Without a carrier it is detected from the number.",
        body: z.object({
          carrier: z.string().min(1).max(64).optional(),
          tracking_number: trackingNumberField,
          direction: z.enum(DIRECTIONS).default("receiving"),
          label: z.string().max(120).nullable().default(null),
        }),
        response: { 201: parcelSchema, 400: errorBodySchema, 409: errorBodySchema },
      },
    },
    async (request, reply) => {
      const { tracking_number: trackingNumber, direction, label } = request.body;
      // No built-in carrier recognises the number: a fallback tracking service, if added.
      const carrier =
        request.body.carrier ??
        detectCarrier(trackingNumber, null) ??
        (await fallbackCarrier(services.db, services.registry));
      if (carrier === undefined) {
        throw new ApiError(
          400,
          "carrier_not_detected",
          "The carrier could not be detected from this tracking number. Choose one, or add a " +
            "fallback tracking connection (Universal lookup, 17TRACK).",
        );
      }
      try {
        const parcel = await services.parcels.create({
          carrier,
          trackingNumber,
          direction,
          label,
        });
        return await reply.code(201).send(parcel);
      } catch (error) {
        if (error instanceof DuplicateParcelError) {
          throw new ApiError(
            409,
            "duplicate",
            `This parcel is already tracked as ${error.existingId}.`,
            { parcel_id: error.existingId },
          );
        }
        throw error;
      }
    },
  );

  app.patch(
    "/api/v1/parcels/:id",
    {
      preHandler: write,
      schema: {
        tags: ["parcels"],
        summary:
          "Rename, override the status, or archive a parcel. A manual status is never overwritten by carrier updates.",
        params: idParams,
        body: z.object({
          label: z.string().max(120).nullable().optional(),
          manual_status: parcelStatusSchema.nullable().optional(),
          archived: z.boolean().optional(),
        }),
        response: { 200: parcelSchema, 404: errorBodySchema },
      },
    },
    async (request) => {
      const body = request.body;
      const parcel = await services.parcels.update(request.params.id, {
        ...(body.label === undefined ? {} : { label: body.label }),
        ...(body.manual_status === undefined ? {} : { manualStatus: body.manual_status }),
        ...(body.archived === undefined ? {} : { archived: body.archived }),
      });
      if (parcel === undefined) {
        throw notFound("parcel");
      }
      return parcel;
    },
  );

  app.delete(
    "/api/v1/parcels/:id",
    {
      preHandler: write,
      schema: {
        tags: ["parcels"],
        summary: "Stop tracking and delete a parcel.",
        params: idParams,
        response: { 204: z.null(), 404: errorBodySchema },
      },
    },
    async (request, reply) => {
      if (!(await services.parcels.delete(request.params.id))) {
        throw notFound("parcel");
      }
      return reply.code(204).send(null);
    },
  );
}

/** `GET /api/v1/parcels/counts`: what the Connections page and the parcel filters show. */
function registerParcelCountRoute(app: TypedApp, services: Services): void {
  app.get(
    "/api/v1/parcels/counts",
    {
      preHandler: requireScope("read"),
      schema: {
        tags: ["parcels"],
        summary: "How many parcels there are, per carrier and per connection.",
        description:
          "Visible parcels, archived ones included. `active`: not delivered and not archived; " +
          "`delivered`: delivered, archived or not; `archived`: archived. `carriers`: parcels " +
          "per carrier. `connections`: per connection that reported parcels, each parcel " +
          "counted once.",
        response: {
          200: z.object({
            active: countSchema,
            delivered: countSchema,
            archived: countSchema,
            carriers: z.array(z.object({ carrier: z.string(), parcels: countSchema })),
            connections: z.array(
              z.object({
                connection_id: z.string(),
                active: countSchema,
                delivered: countSchema,
                total: countSchema,
              }),
            ),
          }),
        },
      },
    },
    () => parcelCounts(services.db),
  );
}
