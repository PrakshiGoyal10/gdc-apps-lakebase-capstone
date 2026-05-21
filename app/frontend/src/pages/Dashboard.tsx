import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AppConfig } from "../api/types";

export default function Dashboard() {
  const q = useQuery({
    queryKey: ["config"],
    queryFn:  () => api.get<AppConfig>("/api/config"),
    staleTime: 5 * 60 * 1000,
  });

  if (q.isLoading) return <div className="state">Loading…</div>;
  if (q.isError)   return <div className="state err">Failed to load config: {(q.error as Error).message}</div>;

  const { databricks_host, dashboard_id } = q.data!;
  const embedSrc  = `${databricks_host}/embed/dashboardsv3/${dashboard_id}`;
  const openInWs  = `${databricks_host}/dashboardsv3/${dashboard_id}/published`;

  return (
    <>
      <div className="page-h">
        <h1>Dashboard <span className="muted small">· AI/BI embed</span></h1>
        <a className="muted small" href={openInWs} target="_blank" rel="noreferrer">
          Open in workspace ↗
        </a>
      </div>

      {/* Card padding zeroed so the iframe sits flush; height set so the iframe
          fills the viewport below the top bar + page header without scrollbars
          racing against the page's own scroll. */}
      <div className="card" style={{ padding: 0, overflow: "hidden", height: "calc(100vh - 168px)" }}>
        <iframe
          src={embedSrc}
          title="AI/BI dashboard"
          allow="clipboard-read; clipboard-write; fullscreen"
          style={{ width: "100%", height: "100%", border: 0, display: "block" }}
        />
      </div>

      <div className="muted small" style={{ marginTop: 8 }}>
        If the panel is blank, the workspace likely hasn't allowlisted this app's
        host under <em>Settings → Security → External access → Embed Dashboard</em>.
        Without that, the iframe is blocked by <code>X-Frame-Options</code>.
      </div>
    </>
  );
}
