"""重识别风险评估脚本：直接标识残留 / 准标识 k / 敏感列多样性（Phase 2）。"""

import importlib.util
import json
import pathlib

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "deid_reidentification_report.py"
_spec = importlib.util.spec_from_file_location("deid_reid_report", SCRIPT)
report_mod = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(report_mod)


def rows_of(spec_rows):
    return spec_rows


def test_direct_identifier_scan_flags_phone_without_leaking_values():
    rows = [
        {"subjectKey": "sk_1", "note": "call 13800138000"},
        {"subjectKey": "sk_2", "note": "clean"},
    ]
    result = report_mod.scan_direct_identifiers(rows)
    assert result["passed"] is False
    assert result["affected_rows"] == 1
    assert result["hit_columns"] == {"note:phone": 1}
    # 报告里不出现原始值
    assert "13800138000" not in json.dumps(result, ensure_ascii=False)


def test_dictionary_hits_count_as_person_name():
    rows = [{"note": "张三复诊"}, {"note": "复诊"}]
    result = report_mod.scan_direct_identifiers(rows, ["张三"])
    assert result["hit_columns"] == {"note:person_name": 1}


def test_k_anonymity_pass_and_fail():
    ok = [{"ageBand": "30-39", "sex": "male"} for _ in range(5)]
    result = report_mod.k_anonymity(ok, ["ageBand", "sex"], 5)
    assert result["passed"] is True
    assert result["min_k_observed"] == 5
    assert result["unique_rows"] == 0

    bad = [{"ageBand": "30-39", "sex": "male"}] + [
        {"ageBand": "40-49", "sex": "female"} for _ in range(4)
    ]
    result = report_mod.k_anonymity(bad, ["ageBand", "sex"], 5)
    assert result["passed"] is False
    assert result["unique_rows"] == 1
    # 两个组合都低于阈值（规模 1 与 4）
    assert result["violating_classes"] == 2
    assert result["violating_rows"] == 5
    assert result["min_k_observed"] == 1


def test_k_anonymity_missing_columns_are_not_silently_bucketed():
    rows = [{"ageBand": "30-39", "sex": "male"} for _ in range(5)] + [{"ageBand": "30-39"}]
    result = report_mod.k_anonymity(rows, ["ageBand", "sex"], 5)
    assert result["missing_key_rows"] == 1
    assert result["passed"] is False


def test_no_quasi_identifiers_is_not_a_pass():
    result = report_mod.k_anonymity([{"x": 1}], [], 5)
    assert result["checked"] is False
    assert result["passed"] is False


def test_l_diversity_reports_min_distinct_per_column():
    rows = [
        {"ageBand": "30-39", "sex": "m", "lab": "a"},
        {"ageBand": "30-39", "sex": "m", "lab": "a"},
        {"ageBand": "30-39", "sex": "m", "lab": "b"},
    ]
    result = report_mod.l_diversity(rows, ["ageBand", "sex"], ["lab"], 2)
    assert result["checked"] is True
    assert result["min_distinct"] == {"lab": 2}
    assert result["passed"] is True


def test_build_report_verdict_and_markdown():
    rows = [{"ageBand": "30-39", "sex": "m", "note": "clean"} for _ in range(5)]
    report = report_mod.build_report(rows, quasi_identifiers=["ageBand", "sex"], min_k=5)
    assert report["verdict"] == "PASS"
    assert report["row_count"] == 5
    md = report_mod.render_markdown(report)
    assert "结论：PASS" in md
    assert "直接标识残留" in md
    assert "准标识 k 匿名性" in md
    assert "不构成「匿名化」结论" in md


def test_build_report_fails_on_residual_identifier():
    rows = [{"ageBand": "30-39", "sex": "m", "note": "13800138000"} for _ in range(5)]
    report = report_mod.build_report(rows, quasi_identifiers=["ageBand", "sex"], min_k=5)
    assert report["verdict"] == "FAIL"
    assert "13800138000" not in json.dumps(report, ensure_ascii=False)


def test_cli_writes_json_and_markdown(tmp_path):
    rows_path = tmp_path / "rows.jsonl"
    rows_path.write_text(
        "\n".join(
            json.dumps({"ageBand": "30-39", "sex": "m", "lab": "x"}) for _ in range(5)
        )
        + "\n",
        encoding="utf-8",
    )
    out = tmp_path / "report.json"
    md = tmp_path / "report.md"
    code = report_mod.main(
        [
            "--rows",
            str(rows_path),
            "--out",
            str(out),
            "--markdown",
            str(md),
            "--quasi-identifiers",
            "ageBand,sex",
            "--min-k",
            "5",
        ]
    )
    assert code == 0
    payload = json.loads(out.read_text(encoding="utf-8"))
    assert payload["verdict"] == "PASS"
    assert "结论：PASS" in md.read_text(encoding="utf-8")


def test_cli_exit_code_is_nonzero_on_failure(tmp_path):
    rows_path = tmp_path / "rows.jsonl"
    rows_path.write_text(
        json.dumps({"ageBand": "30-39", "sex": "m", "note": "13900139000"}) + "\n",
        encoding="utf-8",
    )
    code = report_mod.main(
        ["--rows", str(rows_path), "--out", str(tmp_path / "r.json"), "--quasi-identifiers", "ageBand,sex"]
    )
    assert code == 1
