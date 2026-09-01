import type { APIRequestContext, APIResponse } from '@playwright/test';
import { env } from '../config/env.js';
import type { InventoryItem, ListResponse } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * Inventory service client for POST /api/v1/inventory/items and friends.
 *
 * Design notes:
 *  - Methods return the raw `APIResponse` so a test can assert on status codes
 *    and error envelopes. A client that throws on non-2xx cannot test negatives.
 *  - The payload type is `unknown`, on purpose: negative tests must be able to
 *    send a malformed body (wrong type, missing field) without fighting TypeScript.
 *  - The bearer token is injected per call, so one client can exercise admin,
 *    cashier, expired and absent-token paths.
 */
export class InventoryApi {
  constructor(private readonly request: APIRequestContext) {}

  private headers(token?: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }

  async createItem(payload: unknown, token?: string): Promise<APIResponse> {
    logger.step(`POST /inventory/items ${JSON.stringify(payload)}`);
    return this.request.post(`${env.apiBaseURL}/inventory/items`, {
      headers: this.headers(token),
      data: payload as Record<string, unknown>,
    });
  }

  /** Sends a raw string body - the only way to test the malformed-JSON 400 path. */
  async createItemWithRawBody(rawBody: string, token?: string): Promise<APIResponse> {
    return this.request.post(`${env.apiBaseURL}/inventory/items`, {
      headers: this.headers(token),
      data: rawBody,
    });
  }

  async listItems(token: string, params?: { sku?: string }): Promise<APIResponse> {
    return this.request.get(`${env.apiBaseURL}/inventory/items`, {
      headers: this.headers(token),
      params: params?.sku ? { sku: params.sku } : {},
    });
  }

  async getItem(id: string, token: string): Promise<APIResponse> {
    return this.request.get(`${env.apiBaseURL}/inventory/items/${id}`, {
      headers: this.headers(token),
    });
  }

  async deleteItem(id: string, token: string): Promise<APIResponse> {
    return this.request.delete(`${env.apiBaseURL}/inventory/items/${id}`, {
      headers: this.headers(token),
    });
  }

  /** Typed happy-path helper for tests that need a seeded item, not a status code. */
  async seedItem(payload: unknown, token: string): Promise<InventoryItem> {
    const response = await this.createItem(payload, token);
    if (response.status() !== 201) {
      throw new Error(`Seeding failed: ${response.status()} ${await response.text()}`);
    }
    return (await response.json()) as InventoryItem;
  }

  async listAll(token: string): Promise<ListResponse<InventoryItem>> {
    const response = await this.listItems(token);
    return (await response.json()) as ListResponse<InventoryItem>;
  }
}
