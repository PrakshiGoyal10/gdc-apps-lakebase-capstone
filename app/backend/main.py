"""FastAPI entrypoint with auth/db probe endpoints for T2.

Three /debug endpoints used to satisfy the T2 'Done when' checklist:

  GET /debug/whoami-obo  → identity from obo_client(request)
  GET /debug/whoami-sp   → identity from sp_client()
  GET /debug/db-ping     → SELECT 1 via lakebase_sp()

Delete /debug once T3 lands real routers.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Pull app/.env into the process so WorkspaceClient and db.py find their config.
load_dotenv()

from .auth import caller_email, obo_client, sp_client  # noqa: E402
from .db import lakebase_sp  # noqa: E402
from .routers import customers, genie, jobs  # noqa: E402

app = FastAPI(title="capstone-app")
app.include_router(customers.router)
app.include_router(genie.router)
app.include_router(jobs.router)


@app.get("/api/config")
def get_config() -> dict:
    """Public (non-auth) config the React app needs at boot.

    The frontend uses this to build the AI/BI dashboard embed URL
    (T4: ${databricks_host}/embed/dashboardsv3/${dashboard_id}). Keeping
    these out of the JS bundle means a workspace move only needs an
    app.yaml env change, not a frontend rebuild.
    """
    return {
        "databricks_host": os.environ["DATABRICKS_HOST"].rstrip("/"),
        "dashboard_id":    os.environ["DASHBOARD_ID"],
        "genie_space_id":  os.environ["GENIE_SPACE_ID"],
    }


@app.get("/debug/whoami-obo")
def whoami_obo(request: Request) -> dict:
    me = obo_client(request).current_user.me()
    return {
        "userName":      me.user_name,
        "displayName":   me.display_name,
        "id":            me.id,
        "fwd_email":     caller_email(request),
        "note":          "Should match the calling user, NOT the app SP.",
    }


@app.get("/debug/whoami-sp")
def whoami_sp() -> dict:
    me = sp_client().current_user.me()
    return {
        "userName":    me.user_name,
        "displayName": me.display_name,
        "id":          me.id,
        "note":        "Should be the app's service principal once deployed.",
    }


@app.get("/debug/db-ping")
def db_ping() -> dict:
    with lakebase_sp() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1, current_user, current_database()")
        one, pg_user, pg_db = cur.fetchone()
    return {"select_1": one, "pg_user": pg_user, "pg_database": pg_db}


# Serve the built React bundle (production). When backend/static/ doesn't
# exist (e.g. running locally with `npm run dev` proxying /api to uvicorn),
# this block is skipped so dev mode keeps working.
_STATIC_DIR = Path(__file__).resolve().parent / "static"
if _STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=_STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_catchall(full_path: str) -> FileResponse:
        # React Router owns client-side routes — return index.html for anything
        # not matched by an API route or a static asset above.
        return FileResponse(_STATIC_DIR / "index.html")
