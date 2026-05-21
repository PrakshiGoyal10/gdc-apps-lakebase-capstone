"""Forward-ETL job trigger + status polling.

SP-only — job-triggering doesn't need to attribute to a user, and the
Apps Jobs API doesn't accept OBO tokens for run_now either way.
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Path, Query
from pydantic import BaseModel

from ..auth import sp_client

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


class RunOut(BaseModel):
    run_id:       int
    state:        str                 # PENDING / RUNNING / TERMINATED / SUCCESS / FAILED / ...
    result_state: Optional[str] = None
    start_time:   Optional[datetime] = None
    end_time:     Optional[datetime] = None


class RunHistory(BaseModel):
    runs: list[RunOut]


def _job_id() -> int:
    try:
        return int(os.environ["FORWARD_ETL_JOB_ID"])
    except (KeyError, ValueError) as e:
        raise HTTPException(
            status_code=500,
            detail="FORWARD_ETL_JOB_ID env var missing or not an integer. "
                   "Add it to app/.env (locally) and app.yaml (deployed).",
        ) from e


def _to_run_out(run) -> RunOut:
    """Normalise a Databricks SDK Run object to our RunOut model."""
    life   = run.state.life_cycle_state.value if run.state and run.state.life_cycle_state else "UNKNOWN"
    result = run.state.result_state.value     if run.state and run.state.result_state     else None
    return RunOut(
        run_id       = run.run_id,
        state        = str(life),
        result_state = str(result) if result else None,
        start_time   = datetime.fromtimestamp(run.start_time / 1000) if run.start_time else None,
        end_time     = datetime.fromtimestamp(run.end_time   / 1000) if run.end_time   else None,
    )


@router.post("/run-forward-etl", response_model=RunOut, status_code=202)
def run_forward_etl() -> RunOut:
    """Kick off the forward-ETL job. Returns the new run_id; status comes from GET /api/jobs/{run_id}."""
    w = sp_client()
    run = w.jobs.run_now(job_id=_job_id())
    return RunOut(run_id=run.run_id, state="PENDING")


@router.get("/{run_id}", response_model=RunOut)
def get_run(run_id: int = Path(..., ge=1)) -> RunOut:
    w = sp_client()
    try:
        run = w.jobs.get_run(run_id=run_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found: {e}")
    return _to_run_out(run)


@router.get("", response_model=RunHistory)
def list_recent_runs(limit: int = Query(10, ge=1, le=50)) -> RunHistory:
    """Recent runs of the forward-ETL job, newest first."""
    w = sp_client()
    runs = list(w.jobs.list_runs(job_id=_job_id(), limit=limit))
    return RunHistory(runs=[_to_run_out(r) for r in runs])
