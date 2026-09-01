/** Response contracts for the endpoints under test. Kept in one place so a
 *  backend change breaks compilation instead of silently passing assertions. */

export interface LoginResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user: { id: string; name: string; email: string; role: string; tenant_id: string };
}

export interface InventoryItem {
  id: string;
  item_name: string;
  sku: string;
  quantity: number;
  price: number;
  category_id: number;
  category_name: string | null;
  tenant_id: string;
  created_at: string;
  created_by: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; issue: string }>;
  };
}

export interface ListResponse<T> {
  data: T[];
  meta: { total: number; tenant_id: string };
}
