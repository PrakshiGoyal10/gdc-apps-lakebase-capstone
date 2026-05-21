"""Auth client factories for the capstone app.

Two clients, two identities:

- ``sp_client()`` returns a process-wide WorkspaceClient authenticated
  as the app's service principal. The SDK picks up its credentials from
  the runtime (env vars in production; profile / env locally). Use for
  all Lakebase access and any background / cron work.

- ``obo_client(request)`` returns a per-request WorkspaceClient acting
  on behalf of the calling user. The user's bearer is forwarded by the
  Apps proxy as ``X-Forwarded-Access-Token``. Use for SQL warehouse and
  Genie calls so workspace-level RLS and audit reflect the real user.

There is intentionally no ``lakebase_obo`` — Lakebase doesn't yet
support OBO scopes, so calls would fail with
``Provided OAuth token does not have required scopes: postgres``.
The audit log records the calling user's email separately, via
``X-Forwarded-Email``.
"""

from __future__ import annotations

import os
from functools import lru_cache

from databricks.sdk import WorkspaceClient
from fastapi import HTTPException, Request

OBO_TOKEN_HEADER = "X-Forwarded-Access-Token"
OBO_EMAIL_HEADER = "X-Forwarded-Email"


@lru_cache(maxsize=1)
def sp_client() -> WorkspaceClient:
    """Service-principal WorkspaceClient, shared process-wide.

    The Databricks Apps runtime injects the SP's
    ``DATABRICKS_CLIENT_ID``/``DATABRICKS_CLIENT_SECRET`` (and host)
    into the env, so a bare ``WorkspaceClient()`` resolves to the
    SP identity. Locally, set the same vars or a ``DATABRICKS_*``
    profile.
    """
    return WorkspaceClient()


def obo_client(request: Request) -> WorkspaceClient:
    """Per-request WorkspaceClient acting as the calling user.

    Raises 401 when the OBO header is absent. That almost always means
    one of:
      * the workspace's User Authorization (preview) toggle is off, so
        the proxy never injects the header even after a successful
        ``user_api_scopes`` PATCH;
      * the calling user hasn't completed the consent screen yet.
    """
    token = request.headers.get(OBO_TOKEN_HEADER)
    if not token:
        raise HTTPException(
            status_code=401,
            detail=(
                f"Missing {OBO_TOKEN_HEADER}. Enable Workspace settings → "
                "Apps → User authorization (preview) and have the user "
                "click 'Authorize' on the consent screen."
            ),
        )
    host = os.environ.get("DATABRICKS_HOST") or sp_client().config.host
    return WorkspaceClient(host=host, token=token)


def caller_email(request: Request) -> str:
    """Calling user's email, taken from the Apps-proxy header.

    Used as the ``actor`` value when recording an entry in
    ``customer_audit_log``. Returns ``"unknown"`` if the header is
    missing (e.g. in a local dev request without the proxy).
    """
    return request.headers.get(OBO_EMAIL_HEADER, "unknown")
