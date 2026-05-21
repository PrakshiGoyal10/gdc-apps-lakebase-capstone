"""Genie endpoints (OBO).

T5 first endpoint: GET /api/customers — paginated list with segment /
LTV / churn filters. Reads gold.customers_synced via lakebase_sp; the
synced table is kept fresh from <catalog>.gold.customers by the
CONTINUOUS pipeline declared in T1.
"""

from __future__ import annotations
import os
from typing import Any, Optional
from fastapi import APIRouter, HTTPException, Path, Request
from pydantic import BaseModel, Field
from ..auth import obo_client

router = APIRouter(prefix="/api/genie", tags=["genie"])

class AttachmentRow(BaseModel):
      columns: list[str]
      rows: list[list]

def _genie(request: Request):
    return obo_client(request).genie

def _space_id() -> str:
      return os.environ["GENIE_SPACE_ID"]

@router.post("/conversations")
def start_conversation(request: Request, body: dict[str, str]) -> dict[str, Any]:
      resp = _genie(request).start_conversation(space_id=_space_id(), content=body.content)
      return {
          "conversation_id":resp.conversation_id,
          "message_id":resp.message_id,
          "status":str(resp.message.status.value if resp.message else "SUBMITTED"),
          "content":body.content,
      }

@router.post("/conversations/{conv_id}/messages")
def create_message(request: Request, 
                    body: dict[str,str],
                    conv_id: str = Path(...)) -> dict[str, Any]:
      
    msg = _genie(request).create_message(
        space_id=_space_id(), conversation_id=conv_id, content=body.content,
    )
    return {
        "conversation_id":conv_id,
        "message_id":msg.id,
        "status":str(msg.status.value),
        "content":body.content,
    }

@router.get("/conversations/{conv_id}/messages/{msg_id}")
def get_message(request: Request,
                  conv_id: str = Path(...), msg_id: str = Path(...)) -> dict[str, Any]:
      msg = _genie(request).get_message(space_id=_space_id(),
                                conversation_id=conv_id, message_id=msg_id)

      out = {
          "conversation_id":conv_id,
          "message_id":msg_id,
          "status":str(msg.status.value),
          "content":msg.content,
      }

      # If completed and has an attachment with a query result, pull the rows.
      if str(msg.status.value) == "COMPLETED" and msg.attachments:
          att = msg.attachments[0]
          # Genie can return either text or a query — surface both if present
          if getattr(att, "text", None) and getattr(att.text, "content", None):
              out.answer_text = att.text.content
          if getattr(att, "query", None):
              result = _genie(request).get_message_attachment_query_result(
                  space_id=_space_id(),
                  conversation_id=conv_id,
                  message_id=msg_id,
                  attachment_id=att.attachment_id,
              )
              sr = result.statement_response
              cols = [c.name for c in sr.manifest.schema.columns]
              rows = sr.result.data_array or []
              out.attachment = AttachmentRow(columns=cols, rows=rows[:50])  # cap preview
      return out