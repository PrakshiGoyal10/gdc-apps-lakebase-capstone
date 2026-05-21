// Mirrors backend/app/backend/routers/customers.py Pydantic models.
// Keep field names in sync — TanStack Query passes these straight through.

export interface CustomerRow {
  customer_id: string;
  first_name: string;
  last_name: string;
  email: string;
  segment_id: string;
  lifetime_value: number;
  churn_score: number;
}

export interface CustomerPage {
  items: CustomerRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface CustomerProfile {
  customer_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  country: string | null;
  city: string | null;
  gender: string | null;
  age: number | null;
  signup_date: string | null;
  last_purchase_date: string | null;
  segment_id: string;
  lifetime_value: number;
  churn_score: number;
  updated_at: string | null;
}

export interface TransactionRow {
  transaction_id: string;
  product_id: string;
  transaction_date: string;
  channel: string;
  status: string;
  amount: number;
}

export interface CustomerDetailData {
  profile: CustomerProfile;
  activity: TransactionRow[];
}

export interface CategorySpend {
  category: string;
  spend: number;
}

export interface CustomerMetrics {
  customer_id: string;
  lifetime_spend: number;
  last_30_day_spend: number;
  last_90_day_spend: number;
  open_ticket_count: number;
  avg_csat: number | null;
  top_categories: CategorySpend[];
}

export interface Note {
  id: number;
  customer_id: string;
  note: string;
  author: string | null;
  created_at: string;
  processed: boolean;
}

export interface SegmentOverrideRow {
  id: number;
  customer_id: string;
  new_segment_id: string;
  reason: string | null;
  created_at: string;
  processed: boolean;
}

export interface CustomerFilters {
  segment?: string;
  min_ltv?: number;
  max_churn?: number;
  page: number;
  page_size: number;
}

export const SEGMENT_IDS = ["S1", "S2", "S3", "S4", "S5", "S6", "S7"] as const;

export interface AppConfig {
  databricks_host: string;
  dashboard_id: string;
  genie_space_id: string;
}

export interface GenieAttachment {
  columns: string[];
  rows: unknown[][];
}

export interface GenieMessage {
  message_id: string;
  conversation_id: string;
  status: "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | string;
  content?: string | null;
  answer_text?: string | null;
  attachment?: GenieAttachment | null;
}

export interface JobRun {
  run_id: number;
  state: string;                // PENDING / RUNNING / TERMINATED / ...
  result_state?: string | null; // SUCCESS / FAILED / CANCELED / null
  start_time?: string | null;
  end_time?: string | null;
}

export interface JobRunHistory {
  runs: JobRun[];
}
