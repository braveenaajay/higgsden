"""Embedding service.

Phase 4 replaces the placeholder model with a real embedding model behind the same interface.
This service never decides who can see what: the API applies Agency and Client filters.
"""

import hashlib
import math
import struct

from fastapi import FastAPI
from pydantic import BaseModel, Field

DIMENSIONS = 1024
MODEL_ID = "placeholder-hash-v1"

app = FastAPI(title="HiggsDEN embedding service")


class EmbedQueryRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)


class EmbedQueryResponse(BaseModel):
    model: str
    dimensions: int
    vector: list[float]


def placeholder_embedding(text: str) -> list[float]:
    """Deterministic unit vector derived from the text hash. Not semantically meaningful."""
    values: list[float] = []
    counter = 0
    while len(values) < DIMENSIONS:
        digest = hashlib.sha256(f"{counter}:{text}".encode()).digest()
        values.extend(v / 2**31 for v in struct.unpack(">8i", digest))
        counter += 1
    values = values[:DIMENSIONS]
    norm = math.sqrt(sum(v * v for v in values)) or 1.0
    return [v / norm for v in values]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL_ID}


@app.post("/embed-query", response_model=EmbedQueryResponse)
def embed_query(body: EmbedQueryRequest) -> EmbedQueryResponse:
    return EmbedQueryResponse(model=MODEL_ID, dimensions=DIMENSIONS, vector=placeholder_embedding(body.text))
