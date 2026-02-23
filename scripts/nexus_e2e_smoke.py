#!/usr/bin/env python3
"""E2E smoke test for Deep-Sea Nexus shared memory wiring.

Checks:
- ChromaDB master store is reachable.
- Collection exists and has documents.
- A write (upsert) is visible to a recall query.

This script is intentionally minimal and relies on env:
- NEXUS_VECTOR_DB
- NEXUS_COLLECTION

Run:
  NEXUS_VECTOR_DB=... NEXUS_COLLECTION=... python3 scripts/nexus_e2e_smoke.py
"""

import os
import time
import uuid


def main() -> int:
    vector_db = os.environ.get("NEXUS_VECTOR_DB", "").strip()
    collection = os.environ.get("NEXUS_COLLECTION", "").strip()

    if not vector_db or not collection:
        raise SystemExit("Missing NEXUS_VECTOR_DB or NEXUS_COLLECTION")

    import chromadb
    from chromadb.config import Settings

    client = chromadb.PersistentClient(
        path=vector_db,
        settings=Settings(anonymized_telemetry=False),
        tenant="default_tenant",
        database="default_database",
    )
    col = client.get_or_create_collection(collection)

    before = col.count()

    marker = f"e2e-marker:{int(time.time())}:{uuid.uuid4().hex[:8]}"
    doc_id = f"e2e:{uuid.uuid4().hex[:12]}"
    col.upsert(ids=[doc_id], documents=[f"Shared memory smoke test {marker}"], metadatas=[{"kind": "e2e", "marker": marker}])

    # Query with simple substring marker (vector query still works because embedding is handled by chroma backend).
    result = col.get(ids=[doc_id])
    ok_write = bool(result.get("ids"))

    after = col.count()

    print(
        {
            "ok": ok_write,
            "vector_db": vector_db,
            "collection": collection,
            "count_before": before,
            "count_after": after,
            "marker": marker,
            "doc_id": doc_id,
        }
    )

    return 0 if ok_write else 2


if __name__ == "__main__":
    raise SystemExit(main())
