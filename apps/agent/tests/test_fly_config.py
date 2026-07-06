from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_connector_fly_configs_advertise_reachable_ws_hosts():
    configs = {
        "fly.connector-a.toml": "medtrust-connector-a.internal",
        "fly.connector-b.toml": "medtrust-connector-b.internal",
    }

    for name, host in configs.items():
        text = (ROOT / "fly-services" / "connector" / name).read_text()
        assert f'AGENT_WS_ADVERTISE_HOST = "{host}"' in text
        assert 'AGENT_WS_HOST = "::"' in text
