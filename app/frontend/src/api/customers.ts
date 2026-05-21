import { api } from "./client";
import type {
  CustomerDetailData,
  CustomerFilters,
  CustomerMetrics,
  CustomerPage,
  Note,
  SegmentOverrideRow,
} from "./types";

function qs(filters: CustomerFilters): string {
  const p = new URLSearchParams();
  p.set("page", String(filters.page));
  p.set("page_size", String(filters.page_size));
  if (filters.segment) p.set("segment", filters.segment);
  if (filters.min_ltv !== undefined && !Number.isNaN(filters.min_ltv))
    p.set("min_ltv", String(filters.min_ltv));
  if (filters.max_churn !== undefined && !Number.isNaN(filters.max_churn))
    p.set("max_churn", String(filters.max_churn));
  return p.toString();
}

export const customersApi = {
  list:    (f: CustomerFilters) => api.get<CustomerPage>(`/api/customers?${qs(f)}`),
  detail:  (id: string)         => api.get<CustomerDetailData>(`/api/customers/${id}`),
  metrics: (id: string)         => api.get<CustomerMetrics>(`/api/customers/${id}/metrics`),
  notes:   (id: string)         => api.get<Note[]>(`/api/customers/${id}/notes`),
  addNote: (id: string, note: string) =>
    api.post<Note>(`/api/customers/${id}/notes`, { note }),
  overrideSegment: (id: string, new_segment_id: string, reason?: string) =>
    api.post<SegmentOverrideRow>(`/api/customers/${id}/segment`, { new_segment_id, reason }),
};
