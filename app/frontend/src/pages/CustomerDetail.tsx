import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { customersApi } from "../api/customers";
import { SEGMENT_IDS } from "../api/types";
import type { CustomerDetailData, CustomerMetrics, Note } from "../api/types";

type TabKey = "profile" | "activity" | "notes" | "segment";

const TABS: { key: TabKey; label: string }[] = [
  { key: "profile",  label: "Profile" },
  { key: "activity", label: "Activity" },
  { key: "notes",    label: "Notes" },
  { key: "segment",  label: "Segment" },
];

export default function CustomerDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const [tab, setTab] = useState<TabKey>("profile");

  // Per the Optimizations spec: fan out tab fetches in parallel so the
  // detail page paints in one round-trip's worth of latency, not four.
  const [detailQ, metricsQ, notesQ] = useQueries({
    queries: [
      { queryKey: ["customer",         id], queryFn: () => customersApi.detail(id),  staleTime: 30_000 },
      { queryKey: ["customer-metrics", id], queryFn: () => customersApi.metrics(id), staleTime: 60_000 },
      { queryKey: ["customer-notes",   id], queryFn: () => customersApi.notes(id),   staleTime: 15_000 },
    ],
  });

  if (detailQ.isLoading) return <div className="state">Loading customer…</div>;
  if (detailQ.isError)   return <div className="state err">Failed to load: {(detailQ.error as Error).message}</div>;
  const detail = detailQ.data!;

  return (
    <>
      <div className="page-h">
        <h1>
          {detail.profile.first_name} {detail.profile.last_name}{" "}
          <span className="muted small">· {detail.profile.customer_id}</span>
        </h1>
        <Link to="/customers" className="muted small">← Back to list</Link>
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <div key={t.key}
               className={`tab ${tab === t.key ? "active" : ""}`}
               onClick={() => setTab(t.key)}>
            {t.label}
          </div>
        ))}
      </div>

      {tab === "profile"  && <ProfileTab detail={detail} metrics={metricsQ.data} metricsLoading={metricsQ.isLoading} metricsError={metricsQ.error as Error | null} />}
      {tab === "activity" && <ActivityTab detail={detail} />}
      {tab === "notes"    && <NotesTab    id={id} notes={notesQ.data} loading={notesQ.isLoading} error={notesQ.error as Error | null} />}
      {tab === "segment"  && <SegmentTab  id={id} currentSegment={detail.profile.segment_id} />}
    </>
  );
}

/* ── Profile ─────────────────────────────────────────── */

function ProfileTab({ detail, metrics, metricsLoading, metricsError }: {
  detail: CustomerDetailData;
  metrics: CustomerMetrics | undefined;
  metricsLoading: boolean;
  metricsError: Error | null;
}) {
  const p = detail.profile;
  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Profile</h3>
        <div className="kv">
          <div className="k">Email</div>           <div>{p.email}</div>
          <div className="k">Phone</div>           <div>{p.phone ?? "—"}</div>
          <div className="k">Location</div>        <div>{[p.city, p.country].filter(Boolean).join(", ") || "—"}</div>
          <div className="k">Age / gender</div>    <div>{[p.age, p.gender].filter(Boolean).join(" / ") || "—"}</div>
          <div className="k">Signup date</div>     <div>{p.signup_date ?? "—"}</div>
          <div className="k">Last purchase</div>   <div>{p.last_purchase_date ?? "—"}</div>
          <div className="k">Segment</div>         <div><span className="pill">{p.segment_id}</span></div>
          <div className="k">Lifetime value</div>  <div>${p.lifetime_value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          <div className="k">Churn score</div>     <div>{p.churn_score.toFixed(2)}</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Metrics <span className="muted small">(live — SQL warehouse, OBO)</span></h3>
        {metricsLoading && <div className="state">Computing…</div>}
        {metricsError   && <div className="state err">{metricsError.message}</div>}
        {metrics && (
          <div className="kv">
            <div className="k">Lifetime spend</div>     <div>${metrics.lifetime_spend.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            <div className="k">Last 30 days</div>       <div>${metrics.last_30_day_spend.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            <div className="k">Last 90 days</div>       <div>${metrics.last_90_day_spend.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            <div className="k">Open tickets</div>       <div>{metrics.open_ticket_count}</div>
            <div className="k">Avg CSAT</div>           <div>{metrics.avg_csat == null ? "—" : metrics.avg_csat.toFixed(2)}</div>
            <div className="k">Top categories</div>
            <div>
              {metrics.top_categories.length === 0 ? "—" : metrics.top_categories.map(c => (
                <span key={c.category} className="pill" style={{ marginRight: 6 }}>
                  {c.category}: ${c.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ── Activity ────────────────────────────────────────── */

function ActivityTab({ detail }: { detail: CustomerDetailData }) {
  if (detail.activity.length === 0) {
    return <div className="card state">No recent transactions.</div>;
  }
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Recent activity <span className="muted small">(last 20)</span></h3>
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Transaction</th><th>Product</th>
            <th>Channel</th><th>Status</th><th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {detail.activity.map(t => (
            <tr key={t.transaction_id}>
              <td>{t.transaction_date}</td>
              <td><code>{t.transaction_id}</code></td>
              <td><code>{t.product_id}</code></td>
              <td>{t.channel}</td>
              <td><span className={`pill ${t.status === "completed" ? "good" : t.status === "cancelled" ? "bad" : "warn"}`}>{t.status}</span></td>
              <td className="num">${t.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Notes ───────────────────────────────────────────── */

function NotesTab({ id, notes, loading, error }: {
  id: string;
  notes: Note[] | undefined;
  loading: boolean;
  error: Error | null;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");

  const add = useMutation({
    mutationFn: (text: string) => customersApi.addNote(id, text),
    // Optimistic update: write the returned note into the cache so the
    // list paints instantly, then invalidate to reconcile with the server.
    // Without the setQueryData step, the list only refreshed when the
    // Notes tab remounted — failing the T3 'appears in the list
    // immediately' criterion.
    onSuccess: (newNote: Note) => {
      setDraft("");
      qc.setQueryData<Note[]>(
        ["customer-notes", id],
        (old) => [newNote, ...(old ?? [])],
      );
      qc.invalidateQueries({ queryKey: ["customer-notes", id] });
    },
  });

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Add a note</h3>
        <textarea
          placeholder="What did you learn from this customer?"
          value={draft}
          onChange={e => setDraft(e.target.value)}
        />
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <button
            disabled={!draft.trim() || add.isPending}
            onClick={() => add.mutate(draft.trim())}
          >
            {add.isPending ? "Saving…" : "Save note"}
          </button>
          {add.isError && <span className="state err small">{(add.error as Error).message}</span>}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Existing notes</h3>
        {loading && <div className="state">Loading…</div>}
        {error   && <div className="state err">{error.message}</div>}
        {notes && notes.length === 0 && <div className="state">No notes yet.</div>}
        {notes && notes.map(n => (
          <div key={n.id} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
            <div className="muted small">
              {n.author ?? "unknown"} · {new Date(n.created_at).toLocaleString()}
              {n.processed && <span className="pill good small" style={{ marginLeft: 8 }}>processed</span>}
            </div>
            <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{n.note}</div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Segment override ─────────────────────────────────── */

function SegmentTab({ id, currentSegment }: { id: string; currentSegment: string }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState(currentSegment);
  const [reason, setReason] = useState("");

  const override = useMutation({
    mutationFn: () => customersApi.overrideSegment(id, target, reason || undefined),
    // Invalidate the detail query so the Profile tab's segment_id reflects
    // upstream consistency once the forward-ETL job merges this row.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer", id] }),
  });

  const unchanged = target === currentSegment;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Override segment</h3>
      <p className="muted small">
        Writes to <code>customer_segment_overrides_staging</code>. A forward-ETL run
        (Reports tab) promotes overrides into the gold segment table.
      </p>

      <div className="filter-row">
        <div className="field">
          <label>Current</label>
          <div style={{ padding: 7 }}><span className="pill">{currentSegment}</span></div>
        </div>
        <div className="field">
          <label>New segment</label>
          <select value={target} onChange={e => setTarget(e.target.value)}>
            {SEGMENT_IDS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Reason (optional)</label>
          <input type="text" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="why this change?" style={{ minWidth: 280 }} />
        </div>
        <button disabled={override.isPending} onClick={() => override.mutate()}>
          {override.isPending ? "Saving…" : unchanged ? "Confirm" : "Submit override"}
        </button>
      </div>

      {override.isError   && <div className="state err">{(override.error as Error).message}</div>}
      {override.isSuccess && (
        <div className="state good small">
          Override saved (#{override.data.id}, segment {override.data.new_segment_id}, processed={String(override.data.processed)})
        </div>
      )}
    </div>
  );
}
