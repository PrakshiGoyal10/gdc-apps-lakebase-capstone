import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { genieApi } from "../api/genie";
import type { AppConfig, GenieMessage } from "../api/types";

type ChatMsg =
  | { role: "user"; text: string }
  | {
      role: "genie";
      status: string;
      text?: string | null;
      attachment?: GenieMessage["attachment"];
    };

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export default function GenieWidget() {
  const [open, setOpen]   = useState(false);
  const [big,  setBig]    = useState(false);
  const [msgs, setMsgs]   = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy]   = useState(false);
  const [convId, setConvId] = useState<string | null>(null);

  const cfg = useQuery({
    queryKey: ["config"],
    queryFn:  () => api.get<AppConfig>("/api/config"),
    staleTime: 5 * 60 * 1000,
  });

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function pollUntilDone(conv: string, mid: string): Promise<GenieMessage> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const m = await genieApi.poll(conv, mid);
      if (TERMINAL.has(m.status)) return m;
      await new Promise(r => setTimeout(r, 1200));
    }
    throw new Error("Genie timed out after 30s");
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setMsgs(m => [
      ...m,
      { role: "user", text },
      { role: "genie", status: "SUBMITTED" },
    ]);
    setBusy(true);
    try {
      const initial = convId
        ? await genieApi.send(convId, text)
        : await genieApi.start(text);
      if (!convId) setConvId(initial.conversation_id);

      const final = await pollUntilDone(initial.conversation_id, initial.message_id);
      setMsgs(m => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "genie",
          status: final.status,
          text: final.answer_text ?? final.content ?? null,
          attachment: final.attachment ?? null,
        };
        return copy;
      });
    } catch (e: any) {
      setMsgs(m => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "genie",
          status: "FAILED",
          text: e?.message ?? "Error",
        };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  const openInWs = cfg.data
    ? `${cfg.data.databricks_host}/genie/rooms/${cfg.data.genie_space_id}`
    : "#";

  if (!open) {
    return (
      <button className="genie-fab" onClick={() => setOpen(true)}>
        Ask Genie
      </button>
    );
  }

  return (
    <div className={`genie-panel ${big ? "big" : ""}`}>
      <div className="genie-header">
        <strong>Ask Genie</strong>
        <div className="genie-actions">
          <button onClick={() => setBig(b => !b)}>{big ? "Shrink" : "Enlarge"}</button>
          {big && (
            <a href={openInWs} target="_blank" rel="noreferrer">
              Open in workspace ↗
            </a>
          )}
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>

      <div className="genie-body">
        {msgs.length === 0 && (
          <div className="genie-empty">
            Try: <em>"Top 5 segments by lifetime value"</em>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`genie-bubble ${m.role}`}>
            {m.role === "user" ? (
              m.text
            ) : !TERMINAL.has(m.status) ? (
              <em>Genie is thinking…</em>
            ) : (
              <>
                <div>
                  {m.text ??
                    (m.status === "FAILED" ? "Genie couldn't answer." : "")}
                </div>
                {m.attachment && (
                  <table className="genie-table">
                    <thead>
                      <tr>
                        {m.attachment.columns.map(c => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {m.attachment.rows.slice(0, 5).map((r, ri) => (
                        <tr key={ri}>
                          {r.map((v, ci) => (
                            <td key={ci}>{String(v)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="genie-input">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") send();
          }}
          placeholder="Ask a question…"
          disabled={busy}
        />
        <button onClick={send} disabled={busy || !draft.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
