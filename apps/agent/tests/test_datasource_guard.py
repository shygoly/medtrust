"""omop-data-source-access task 4.4 —— agent 不持有、也不能被配置院内数据源凭据。"""

import pathlib
import re

import pytest

from medtrust_agent import config

AGENT_ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_clean_env_passes():
    config.assert_no_datasource_credentials(
        {
            "AGENT_GRPC_PORT": "5024",
            "AGENT_SHARED_TOKEN": "t",
            "AGENT_DATA_PATH": "/data/x",
            "AGENT_LOCAL_PARTY": "hospital-demohospa",
            "AGENT_FEEDBACK_URL": "http://x",  # 词中含 DB 字样不算：按下划线分段匹配
            "HOME": "/tmp",
        }
    )


@pytest.mark.parametrize(
    "name",
    [
        "AGENT_DATABASE_URL",
        "AGENT_DB_PASSWORD",
        "AGENT_CDM_HOST",
        "AGENT_JDBC_URL",
        "CONNECTOR_CDM_SOURCES",
        "CONNECTOR_CDM_SOURCES_FILE",
        "PGPASSWORD",
        "PGHOST",
        "PGPASSFILE",
    ],
)
def test_datasource_credentials_refuse_startup(name):
    with pytest.raises(RuntimeError, match=name):
        config.assert_no_datasource_credentials({name: "x"})


def test_error_names_variables_but_never_echoes_values():
    with pytest.raises(RuntimeError) as err:
        config.assert_no_datasource_credentials({"PGPASSWORD": "s3cret-口令"})
    assert "s3cret-口令" not in str(err.value)


def test_agent_declares_no_database_driver():
    """结构性保证：依赖里没有任何数据库驱动——agent 在代码层面就连不了库。"""
    text = (AGENT_ROOT / "pyproject.toml").read_text(encoding="utf-8").lower()
    drivers = [
        "psycopg", "asyncpg", "sqlalchemy", "pymysql", "mysqlclient", "mysql-connector",
        "pyodbc", "jaydebeapi", "cx_oracle", "oracledb", "pg8000", "dmpython", "ksycopg",
    ]
    found = [d for d in drivers if re.search(rf"[\"']{re.escape(d)}", text)]
    assert found == [], f"agent 不得依赖数据库驱动（D-CN-6）：{found}"
