import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { customersApi } from "../api/customers";
import { SEGMENT_IDS } from "../api/types";
import { useDebounced } from "../hooks/useDebounced";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function Customers() {
  const nav = useNavigate();

  const [segment,   setSegment]   = useState<string>("");
  const [minLtvIn,  setMinLtvIn]  = useState<string>("");
  const [maxChurnIn,setMaxChurnIn]= useState<string>("");
  const [page,      setPage]      = useState(1);
  const [pageSize,  setPageSize]  = useState(25);

  const minLtv   = useDebounced(minLtvIn);
  const maxChurn = useDebounced(maxChurnIn);

  // Reset to page 1 whenever a filter changes; without this you can land
  // on page 7 of a filter that only returns 12 rows.
  const filters = useMemo(() => ({
    segment:   segment || undefined,
    min_ltv:   minLtv   === "" ? undefined : Number(minLtv),
    max_churn: maxChurn === "" ? undefined : Number(maxChurn),
    page,
    page_size: pageSize,
  }), [segment, minLtv, maxChurn, page, pageSize]);

  const q = useQuery({
    queryKey: ["customers", filters],
    queryFn:  () => customersApi.list(filters),
    placeholderData: keepPreviousData,   // smoother pagination — old page stays on screen until new arrives
    staleTime: 10_000,                   // see Optimizations § Caching
  });

  const data    = q.data;
  const total   = data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <div className="page-h">
        <h1>Customers</h1>
        <div className="muted small">{total.toLocaleString()} match{total === 1 ? "" : "es"}</div>
      </div>

      <div className="card">
        <div className="filter-row">
          <div className="field">
            <label>Segment</label>
            <select value={segment} onChange={e => { setPage(1); setSegment(e.target.value); }}>
              <option value="">Any</option>
              {SEGMENT_IDS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Min LTV</label>
            <input type="number" min={0} step={1000} placeholder="e.g. 10000"
              value={minLtvIn} onChange={e => { setPage(1); setMinLtvIn(e.target.value); }} />
          </div>
          <div className="field">
            <label>Max churn</label>
            <input type="number" min={0} max={1} step={0.05} placeholder="0.0 – 1.0"
              value={maxChurnIn} onChange={e => { setPage(1); setMaxChurnIn(e.target.value); }} />
          </div>
          <div className="field">
            <label>Page size</label>
            <select value={pageSize} onChange={e => { setPage(1); setPageSize(Number(e.target.value)); }}>
              {PAGE_SIZE_OPTIONS.map(n => <option key={n}>{n}</option>)}
            </select>
          </div>
          {(segment || minLtv || maxChurn) && (
            <button className="secondary" onClick={() => {
              setSegment(""); setMinLtvIn(""); setMaxChurnIn(""); setPage(1);
            }}>Clear filters</button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        {q.isError && <div className="state err">Failed to load: {(q.error as Error).message}</div>}
        {q.isLoading && !data && <div className="state">Loading…</div>}

        {data && (
          <>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Segment</th>
                  <th className="num">Lifetime value</th>
                  <th className="num">Churn</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map(c => (
                  <tr key={c.customer_id} className="row-link" onClick={() => nav(`/customers/${c.customer_id}`)}>
                    <td>{c.customer_id}</td>
                    <td>{c.first_name} {c.last_name}</td>
                    <td>{c.email}</td>
                    <td><span className="pill">{c.segment_id}</span></td>
                    <td className="num">${c.lifetime_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="num">
                      <span className={`pill ${c.churn_score >= 0.7 ? "bad" : c.churn_score >= 0.4 ? "warn" : "good"}`}>
                        {c.churn_score.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr><td colSpan={6} className="state">No customers match the filters.</td></tr>
                )}
              </tbody>
            </table>

            <div className="pager">
              <button className="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span className="info">Page {page} of {maxPage}</span>
              <button className="secondary" disabled={page >= maxPage} onClick={() => setPage(p => p + 1)}>Next</button>
              {q.isFetching && <span className="muted small">Refreshing…</span>}
            </div>
          </>
        )}
      </div>
    </>
  );
}
