"""Customer endpoints backed by Lakebase synced reads (app SP).

T3 first endpoint: GET /api/customers — paginated list with segment /
LTV / churn filters. Reads gold.customers_synced via lakebase_sp; the
synced table is kept fresh from <catalog>.gold.customers by the
CONTINUOUS pipeline declared in T1.
"""

from __future__ import annotations

import os
from datetime import date, datetime
from typing import Optional

from databricks.sdk.service.sql import StatementParameterListItem, StatementState
from fastapi import APIRouter, HTTPException, Path, Query, Request, Response
from pydantic import BaseModel, Field
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..auth import caller_email, obo_client
from ..db import lakebase_sp

router = APIRouter(prefix="/api/customers", tags=["customers"])


class CustomerRow(BaseModel):
    customer_id:    str
    first_name:     str
    last_name:      str
    email:          str
    segment_id:     str
    lifetime_value: float
    churn_score:    float


class CustomerPage(BaseModel):
    items:     list[CustomerRow]
    total:     int
    page:      int
    page_size: int


class CustomerProfile(BaseModel):
    customer_id:        str
    first_name:         str
    last_name:          str
    email:              str
    phone:              Optional[str] = None
    country:            Optional[str] = None
    city:               Optional[str] = None
    gender:             Optional[str] = None
    age:                Optional[int] = None
    signup_date:        Optional[date] = None
    last_purchase_date: Optional[date] = None
    segment_id:         str
    lifetime_value:     float
    churn_score:        float
    updated_at:         Optional[datetime] = None


class TransactionRow(BaseModel):
    transaction_id:   str
    product_id:       str
    transaction_date: date
    channel:          str
    status:           str
    amount:           float


class CustomerDetail(BaseModel):
    profile:  CustomerProfile
    activity: list[TransactionRow]


class CategorySpend(BaseModel):
    category: str
    spend:    float


class CustomerMetrics(BaseModel):
    customer_id:       str
    lifetime_spend:    float
    last_30_day_spend: float
    last_90_day_spend: float
    open_ticket_count: int
    avg_csat:          Optional[float] = None
    top_categories:    list[CategorySpend]


class NoteCreate(BaseModel):
    note: str = Field(min_length=1, max_length=4000)


class Note(BaseModel):
    id:          int
    customer_id: str
    note:        str
    author:      Optional[str] = None
    created_at:  datetime
    processed:   bool


class SegmentOverride(BaseModel):
    new_segment_id: str           = Field(pattern=r"^S[1-7]$")
    reason:         Optional[str] = Field(default=None, max_length=1000)


class SegmentOverrideRow(BaseModel):
    id:             int
    customer_id:    str
    new_segment_id: str
    reason:         Optional[str] = None
    created_at:     datetime
    processed:      bool


# Filter predicates are written as `(:p IS NULL OR col <op> :p)` so a single
# parameterized statement covers every combination of optional filters
# without resorting to dynamic SQL.
_FILTER = """
  (%(segment)s::text     IS NULL OR segment_id     =  %(segment)s::text)
  AND (%(min_ltv)s::float8   IS NULL OR lifetime_value >= %(min_ltv)s::float8)
  AND (%(max_churn)s::float8 IS NULL OR churn_score    <= %(max_churn)s::float8)
"""

_LIST_SQL = f"""
SELECT customer_id, first_name, last_name, email,
       segment_id, lifetime_value, churn_score
FROM   gold.customers_synced
WHERE  {_FILTER}
ORDER  BY lifetime_value DESC, customer_id
LIMIT  %(limit)s OFFSET %(offset)s
"""

_COUNT_SQL = f"SELECT COUNT(*) AS n FROM gold.customers_synced WHERE {_FILTER}"


@router.get("", response_model=CustomerPage)
def list_customers(
    segment:   Optional[str]   = Query(None, pattern=r"^S[1-7]$"),
    min_ltv:   Optional[float] = Query(None, ge=0),
    max_churn: Optional[float] = Query(None, ge=0, le=1),
    page:      int             = Query(1, ge=1),
    page_size: int             = Query(25, ge=1, le=100),
) -> CustomerPage:
    params = {
        "segment":   segment,
        "min_ltv":   min_ltv,
        "max_churn": max_churn,
        "limit":     page_size,
        "offset":    (page - 1) * page_size,
    }
    with lakebase_sp() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_LIST_SQL, params)
        items = cur.fetchall()
        cur.execute(_COUNT_SQL, params)
        total = cur.fetchone()["n"]

    return CustomerPage(items=items, total=total, page=page, page_size=page_size)


_PROFILE_SQL = """
SELECT customer_id, first_name, last_name, email, phone,
       country, city, gender, age, signup_date, last_purchase_date,
       segment_id, lifetime_value, churn_score, updated_at
FROM   gold.customers_synced
WHERE  customer_id = %(id)s
"""

_ACTIVITY_SQL = """
SELECT transaction_id, product_id, transaction_date, channel, status, amount
FROM   gold.transactions_synced
WHERE  customer_id = %(id)s
ORDER  BY transaction_date DESC, transaction_id DESC
LIMIT  20
"""


@router.get("/{customer_id}", response_model=CustomerDetail)
def get_customer(
    customer_id: str = Path(..., pattern=r"^C\d{7}$"),
) -> CustomerDetail:
    params = {"id": customer_id}
    with lakebase_sp() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_PROFILE_SQL, params)
        profile = cur.fetchone()
        if profile is None:
            raise HTTPException(status_code=404, detail=f"customer {customer_id} not found")
        cur.execute(_ACTIVITY_SQL, params)
        activity = cur.fetchall()

    return CustomerDetail(profile=profile, activity=activity)


# Metrics aggregates against gold Delta via the SQL warehouse using the
# *calling user's* bearer (OBO). Two statements: one scalar row of totals,
# one top-N rollup. Kept as a CTE-free shape so the second query can change
# its LIMIT independently without churning a giant union.
_METRICS_SCALAR_SQL = """
WITH tx AS (
  SELECT amount, transaction_date
  FROM   {cat}.gold.transactions
  WHERE  customer_id = :id AND status = 'completed'
),
tickets AS (
  SELECT status, csat_score
  FROM   {cat}.gold.support_tickets
  WHERE  customer_id = :id
)
SELECT
  COALESCE((SELECT SUM(amount) FROM tx), 0)                                                         AS lifetime_spend,
  COALESCE((SELECT SUM(amount) FROM tx WHERE transaction_date >= CURRENT_DATE - INTERVAL 30 DAYS), 0) AS last_30_day_spend,
  COALESCE((SELECT SUM(amount) FROM tx WHERE transaction_date >= CURRENT_DATE - INTERVAL 90 DAYS), 0) AS last_90_day_spend,
  (SELECT COUNT(*) FROM tickets WHERE status IN ('open','in_progress'))                              AS open_ticket_count,
  (SELECT AVG(csat_score) FROM tickets)                                                              AS avg_csat
"""

_METRICS_TOP_CATEGORIES_SQL = """
SELECT p.category, SUM(t.amount) AS spend
FROM   {cat}.gold.transactions t
JOIN   {cat}.gold.products     p USING (product_id)
WHERE  t.customer_id = :id AND t.status = 'completed'
GROUP  BY p.category
ORDER  BY spend DESC
LIMIT  5
"""


def _run_warehouse(client, sql: str, customer_id: str) -> list[list]:
    """Execute a parameterised statement on the configured warehouse.

    Synchronous wait — the 30s deadline is well beyond the few-hundred-ms
    these aggregates take on serverless. If it ever does time out, the
    state will be ``PENDING`` / ``RUNNING`` and we surface a 504 so the
    UI can retry rather than dangle.
    """
    wh = os.environ["WAREHOUSE_ID"]
    resp = client.statement_execution.execute_statement(
        statement=sql,
        warehouse_id=wh,
        parameters=[StatementParameterListItem(name="id", value=customer_id, type="STRING")],
        wait_timeout="30s",
    )
    if resp.status.state != StatementState.SUCCEEDED:
        msg = resp.status.error.message if resp.status.error else str(resp.status.state)
        raise HTTPException(status_code=504, detail=f"warehouse: {msg}")
    return resp.result.data_array or []


@router.get("/{customer_id}/metrics", response_model=CustomerMetrics)
def get_customer_metrics(
    request: Request,
    customer_id: str = Path(..., pattern=r"^C\d{7}$"),
) -> CustomerMetrics:
    cat = os.environ["CAPSTONE_CATALOG"]
    client = obo_client(request)

    scalar_sql = _METRICS_SCALAR_SQL.format(cat=cat)
    top_sql    = _METRICS_TOP_CATEGORIES_SQL.format(cat=cat)

    scalar_rows = _run_warehouse(client, scalar_sql, customer_id)
    top_rows    = _run_warehouse(client, top_sql,    customer_id)

    if not scalar_rows:
        raise HTTPException(status_code=502, detail="warehouse returned no row for scalar metrics")
    lifetime, d30, d90, open_tix, avg_csat = scalar_rows[0]

    return CustomerMetrics(
        customer_id       = customer_id,
        lifetime_spend    = float(lifetime    or 0),
        last_30_day_spend = float(d30         or 0),
        last_90_day_spend = float(d90         or 0),
        open_ticket_count = int(open_tix      or 0),
        avg_csat          = float(avg_csat)   if avg_csat is not None else None,
        top_categories    = [CategorySpend(category=r[0], spend=float(r[1])) for r in top_rows],
    )


# Staging write + audit append happen in one transaction so a crash between
# the two inserts can't leave the audit log with phantom entries (or worse,
# a real write with no audit trail). conn.transaction() commits on clean
# exit and rolls back on any exception including the 404.
_NOTES_LIST_SQL = """
SELECT id, customer_id, note, author, created_at, processed
FROM   public.customer_notes_staging
WHERE  customer_id = %s
ORDER  BY id DESC
LIMIT  100
"""

_NOTE_INSERT_SQL = """
INSERT INTO public.customer_notes_staging (customer_id, note, author)
VALUES (%s, %s, %s)
RETURNING id, customer_id, note, author, created_at, processed
"""

_AUDIT_INSERT_SQL = """
INSERT INTO public.customer_audit_log (customer_id, actor, action, details)
VALUES (%s, %s, %s, %s)
"""


@router.get("/{customer_id}/notes", response_model=list[Note])
def list_customer_notes(
    customer_id: str = Path(..., pattern=r"^C\d{7}$"),
) -> list[Note]:
    with lakebase_sp() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_NOTES_LIST_SQL, (customer_id,))
        return [Note(**r) for r in cur.fetchall()]


@router.post("/{customer_id}/notes", response_model=Note, status_code=201)
def add_customer_note(
    request: Request,
    body: NoteCreate,
    customer_id: str = Path(..., pattern=r"^C\d{7}$"),
) -> Note:
    actor = caller_email(request)
    with lakebase_sp() as conn:
        with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT 1 FROM gold.customers_synced WHERE customer_id = %s",
                (customer_id,),
            )
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail=f"customer {customer_id} not found")

            cur.execute(_NOTE_INSERT_SQL, (customer_id, body.note, actor))
            row = cur.fetchone()

            cur.execute(
                _AUDIT_INSERT_SQL,
                (
                    customer_id,
                    actor,
                    "note.create",
                    Jsonb({"note_id": row["id"], "note": body.note}),
                ),
            )
    return Note(**row)


# Idempotent UPSERT: at-most-one unprocessed override row per customer.
# FOR UPDATE locks any matching pending row for the duration of the txn so
# two concurrent submits can't both insert. The forward-ETL job (T7) is
# what eventually flips processed=true and merges into gold.
_SEG_PENDING_SQL = """
SELECT id, customer_id, new_segment_id, reason, created_at, processed
FROM   public.customer_segment_overrides_staging
WHERE  customer_id = %s AND processed = false
ORDER  BY id DESC
LIMIT  1
FOR    UPDATE
"""

_SEG_UPDATE_SQL = """
UPDATE public.customer_segment_overrides_staging
SET    new_segment_id = %s,
       reason         = %s,
       created_at     = now()
WHERE  id = %s
RETURNING id, customer_id, new_segment_id, reason, created_at, processed
"""

_SEG_INSERT_SQL = """
INSERT INTO public.customer_segment_overrides_staging (customer_id, new_segment_id, reason)
VALUES (%s, %s, %s)
RETURNING id, customer_id, new_segment_id, reason, created_at, processed
"""


@router.post("/{customer_id}/segment", response_model=SegmentOverrideRow)
def override_customer_segment(
    request: Request,
    body: SegmentOverride,
    response: Response,
    customer_id: str = Path(..., pattern=r"^C\d{7}$"),
) -> SegmentOverrideRow:
    actor = caller_email(request)
    with lakebase_sp() as conn:
        with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT 1 FROM gold.customers_synced WHERE customer_id = %s",
                (customer_id,),
            )
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail=f"customer {customer_id} not found")

            cur.execute(_SEG_PENDING_SQL, (customer_id,))
            existing = cur.fetchone()

            if existing and existing["new_segment_id"] == body.new_segment_id:
                # True no-op — same value already pending. No INSERT, no audit row,
                # no duplicate. Returns the existing override unchanged.
                response.status_code = 200
                return SegmentOverrideRow(**existing)

            if existing:
                cur.execute(
                    _SEG_UPDATE_SQL,
                    (body.new_segment_id, body.reason, existing["id"]),
                )
                row = cur.fetchone()
                action = "segment.update"
                details = {
                    "override_id":   row["id"],
                    "from_segment":  existing["new_segment_id"],
                    "to_segment":    body.new_segment_id,
                    "reason":        body.reason,
                }
                response.status_code = 200
            else:
                cur.execute(
                    _SEG_INSERT_SQL,
                    (customer_id, body.new_segment_id, body.reason),
                )
                row = cur.fetchone()
                action = "segment.create"
                details = {
                    "override_id":   row["id"],
                    "to_segment":    body.new_segment_id,
                    "reason":        body.reason,
                }
                response.status_code = 201

            cur.execute(
                _AUDIT_INSERT_SQL,
                (customer_id, actor, action, Jsonb(details)),
            )
    return SegmentOverrideRow(**row)
