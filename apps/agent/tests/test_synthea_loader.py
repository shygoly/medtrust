"""Tests for Synthea ingest loading on the connector data plane."""

from pathlib import Path

import pytest

from medtrust_agent.dataset import PartyDataset
from medtrust_agent.synthea_loader import load_synthea_tensors, resolve_data_dir

REPO_ROOT = Path(__file__).resolve().parents[3]
SYNTHEA_DIR = REPO_ROOT / "data" / "synthea" / "ingested"


@pytest.mark.skipif(not SYNTHEA_DIR.is_dir(), reason="synthea ingested data not present")
def test_resolve_data_dir_finds_ingested():
    assert resolve_data_dir(str(SYNTHEA_DIR)) == SYNTHEA_DIR.resolve()


@pytest.mark.skipif(not SYNTHEA_DIR.is_dir(), reason="synthea ingested data not present")
def test_load_synthea_tensors_from_repo():
    loaded = load_synthea_tensors(str(SYNTHEA_DIR), "hospital-huashan", max_samples=32)
    assert loaded is not None
    feats, labels, n = loaded
    assert n >= 1
    assert feats.shape[0] == n
    assert labels.shape[0] == n
    assert feats.shape[1] == 7


@pytest.mark.skipif(not SYNTHEA_DIR.is_dir(), reason="synthea ingested data not present")
def test_party_dataset_uses_synthea_when_path_set():
    ds = PartyDataset(
        "hospital-huashan",
        ["structured_ehr"],
        num_samples=64,
        use_party_modalities=False,
        data_path=str(SYNTHEA_DIR),
    )
    assert ds.data_source == str(SYNTHEA_DIR.resolve()) or ds.data_source == str(SYNTHEA_DIR)
    assert len(ds) >= 1
    assert "structured_ehr" in ds.features
