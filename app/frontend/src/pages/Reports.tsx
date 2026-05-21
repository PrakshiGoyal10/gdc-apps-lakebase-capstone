import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jobsApi } from "../api/jobs";
import type { JobRun } from "../api/types";

const TERMINAL = new Set(["TERMINATED", "INTERNAL_ERROR", "SKIPPED"]);

function pillClass(run: JobRun): string {
  if (!TERMINAL.has(run.state)) return "warn";
  if (run.result_state === "SUCCESS") return "good";
  if (run.result_state === "FAILED" || run.result_state === "CANCELED") return "bad";
  return "";
}

function fmt(ts?: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export default function Reports() {
  const qc = useQueryClient();
  const [activeRunId, setActiveRunId] = useState<number | null>(null);

  const history = useQuery({
    queryKey: ["job-history"],
    queryFn:  () => jobsApi.recent(10),
    staleTime: 5_000,
  });

  // Poll the active run every 2s until it reaches a terminal state.
  const active = useQuery({
    queryKey: ["job-run", activeRunId],
    queryFn:  () => jobsApi.getRun(activeRunId!),
    enabled:  activeRunId !== null,
    refetchInterval: (q) => {
      const data = q.state.data as JobRun | undefined;
      return data && TERMINAL.has(data.state) ? false : 2000;
    },
  });

  // When the active run terminates, refresh the history table.
  if (active.data && TERMINAL.has(active.data.state)) {
    qc.invalidateQueries({ queryKey: ["job-history"] });
  }

  const trigger = useMutation({
    mutationFn: () => jobsApi.runForwardEtl(),
    onSuccess: (run) => {
      setActiveRunId(run.run_id);
      qc.invalidateQueries({ queryKey: ["job-history"] });
    },
  });

  return (
    <>
      <div className="page-h">
        <h1>Reports <span className="muted small">· forward ETL</span></h1>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Run forward-ETL</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Pulls unprocessed rows from Lakebase staging
          (<code>customer_notes_staging</code>, <code>customer_segment_overrides_staging</code>)
          and MERGEs them into Delta gold.
        </p>
        <button
          onClick={() => trigger.mutate()}
          disabled={trigger.isPending || (active.data ? !TERMINAL.has(active.data.state) : false)}
        >
          {trigger.isPending ? "Submitting…" : "Run forward-ETL"}
        </button>

        {trigger.isError && (
          <div className="state err" style={{ marginTop: 12 }}>
            {(trigger.error as Error).message}
          </div>
        )}

        {active.data && (
          <div style={{ marginTop: 16 }}>
            <strong>Active run</strong>{" "}
            <code>#{active.data.run_id}</code>{" "}
            <span className={`pill ${pillClass(active.data)}`}>
              {active.data.state}
              {active.data.result_state ? ` · ${active.data.result_state}` : ""}
            </span>
            {!TERMINAL.has(active.data.state) && (
              <span className="muted small" style={{ marginLeft: 8 }}>polling…</span>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Recent runs</h3>
        {history.isLoading && <div className="state">Loading…</div>}
        {history.isError   && <div className="state err">{(history.error as Error).message}</div>}
        {history.data && (
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>State</th>
                <th>Started</th>
                <th>Ended</th>
              </tr>
            </thead>
            <tbody>
              {history.data.runs.map(r => (
                <tr key={r.run_id}>
                  <td><code>#{r.run_id}</code></td>
                  <td>
                    <span className={`pill ${pillClass(r)}`}>
                      {r.state}
                      {r.result_state ? ` · ${r.result_state}` : ""}
                    </span>
                  </td>
                  <td>{fmt(r.start_time)}</td>
                  <td>{fmt(r.end_time)}</td>
                </tr>
              ))}
              {history.data.runs.length === 0 && (
                <tr><td colSpan={4} className="state">No runs yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
