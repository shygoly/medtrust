"""Connector ML sidecar — HTTP API for local tabular FL party training."""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from trainer import train_local_party

app = FastAPI(title="MedTrust Connector ML", version="0.1.0")

RUNTIME = "connector-ml"
BACKEND = os.getenv("ML_BACKEND", "sklearn")


class FlTrainRequest(BaseModel):
    prepared: dict[str, Any]
    spec: dict[str, Any]
    tabularRows: list[dict[str, Any]] = Field(default_factory=list)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "connector-ml", "backend": BACKEND}


@app.get("/v1/fl/environment")
def fl_environment() -> dict[str, Any]:
    return {
        "ready": True,
        "runtime": RUNTIME,
        "details": f"backend={BACKEND}",
    }


@app.post("/v1/fl/train")
def fl_train(body: FlTrainRequest) -> dict[str, Any]:
    prepared = body.prepared
    spec = body.spec
    task_id = str(prepared.get("taskId") or "")
    participant_id = str(prepared.get("participantId") or "")
    spec_hash = str(prepared.get("specHash") or "")
    sample_count = int(prepared.get("sampleCount") or 0)

    if not task_id or not participant_id or not spec_hash:
        raise HTTPException(status_code=400, detail="prepared.taskId/participantId/specHash required")

    if spec.get("modality") != "structured_ehr":
        raise HTTPException(status_code=400, detail="only structured_ehr modality supported")

    result = train_local_party(
        task_id=task_id,
        participant_id=participant_id,
        spec_hash=spec_hash,
        sample_count=sample_count,
        spec=spec,
        tabular_rows=body.tabularRows,
    )
    return result
