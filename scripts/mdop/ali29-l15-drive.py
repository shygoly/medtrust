#!/usr/bin/env python3
"""ali29 MDOP L1.5 演练驱动（任务 11.5）。

远端 python3.6 无 UTF-8 locale，含中文的合约 id 一律用 base64 传入。
本机请求必须绕开 http_proxy。

用法：
  python3 ali29-l15-drive.py offer          # 两院各发起一次合约要约
  python3 ali29-l15-drive.py status         # 轮询两院合约 mdopStatus
  python3 ali29-l15-drive.py l15            # 提交并编译 L1.5 作业
  python3 ali29-l15-drive.py job <jobId>    # 查看作业
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "http://127.0.0.1:5021/api/v1"
SPACE = "sh-med"

DEMOHOSPA = {
    "name": "demohospa",
    "participant": "p-demohospa",
    "account": "admin@demohospa-hospital.com",
    "contract_b64": "c2VlZDpkcC1pbnN1bGluLXBhbmMtaHVhc2hhbjpwLW1lZGRhdGE66IOw5bKb57Sg5pq06Zyywrfog7Dohbrngo7kv6Hlj7fmvJTnpLrnoJTnqbY=",
    "data_product": "dp-insulin-panc-demohospa",
}
DEMOHOSPB = {
    "name": "demohospb",
    "participant": "p-demohospb",
    "account": "admin@rjh.com.cn",
    "contract_b64": "c2VlZDpkcC1pbnN1bGluLXBhbmMtcnVpamluOnAtbWVkZGF0YTrog7DlspvntKDmmrTpnLLCt+iDsOiFuueCjuS/oeWPt+a8lOekuueglOeptg==",
    "data_product": "dp-insulin-panc-demohospb",
}
PASSWORD = "demo123456"

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def request(method, path, body=None, token=None, timeout=180):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with opener.open(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(raw)
        except ValueError:
            return exc.code, raw


def login(site):
    """带缓存的登录：登录端点限速 5 次/分钟，JWT 有效期 15 分钟。"""
    cache_path = "/tmp/mdop-token-%s.json" % site["name"]
    if os.path.exists(cache_path):
        try:
            with open(cache_path) as fh:
                cached = json.load(fh)
            if cached.get("expires_at", 0) > time.time() + 60:
                return cached["token"]
        except (ValueError, KeyError, IOError):
            pass
    status, body = request(
        "POST", "/auth/login", {"account": site["account"], "password": PASSWORD}
    )
    if status != 200:
        # 限速时用过期缓存兜底：宁可试一次也不直接失败。
        if os.path.exists(cache_path):
            with open(cache_path) as fh:
                cached = json.load(fh)
            print("[login] %s 登录失败（%s），回退缓存 token" % (site["name"], status))
            return cached["token"]
        raise SystemExit("登录失败 %s: %s %s" % (site["name"], status, body))
    token = body.get("access_token") or body.get("accessToken")
    if not token:
        raise SystemExit("登录响应没有 access_token：%s" % body)
    expires_at = time.time() + 780
    try:  # 直接从 JWT exp 取过期时间，比信响应字段可靠
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        expires_at = float(json.loads(base64.urlsafe_b64decode(payload_b64))["exp"]) - 30
    except (IndexError, ValueError, KeyError):
        pass
    with open(cache_path, "w") as fh:
        json.dump({"token": token, "expires_at": expires_at}, fh)
    return token


def contract_id(site):
    return base64.b64decode(site["contract_b64"]).decode("utf-8")


def cmd_offer():
    for site in (DEMOHOSPA, DEMOHOSPB):
        token = login(site)
        cid = contract_id(site)
        status, body = request(
            "POST", "/contracts/%s/mdop/offer" % urllib.parse.quote(cid), {}, token
        )
        print("[offer] %-8s http=%s %s" % (site["name"], status, json.dumps(body, ensure_ascii=False)))


def cmd_status():
    for site in (DEMOHOSPA, DEMOHOSPB):
        token = login(site)
        cid = contract_id(site)
        status, body = request("GET", "/contracts/%s/mdop" % urllib.parse.quote(cid), None, token)
        print("[mdop] %-8s http=%s %s" % (site["name"], status, json.dumps(body, ensure_ascii=False)))


def cmd_l15():
    contracts = []
    purpose = None
    for site in (DEMOHOSPA, DEMOHOSPB):
        token = login(site)
        cid = contract_id(site)
        status, body = request("GET", "/contracts/%s/mdop" % urllib.parse.quote(cid), None, token)
        if status != 200 or (body or {}).get("mdopStatus") != "active":
            raise SystemExit("合约未生效，先跑 offer/status：%s %s" % (site["name"], body))
        contracts.append(cid)
        # 作业用途必须逐字等于合约用途码（编译期 assertUsableForJob 校验）。
        purpose = (body.get("contract") or {}).get("purpose") or purpose
    if not purpose:
        raise SystemExit("无法从合约读出用途码")

    payload = {
        "purpose": purpose,
        "applicant": {"org": "示范乙医院", "project": "MDOP-L15-DEMO"},
        "contracts": contracts,
        "drug": "insulin",
        "hospitals": [
            {"participantId": DEMOHOSPA["participant"], "dataProductId": DEMOHOSPA["data_product"]},
            {"participantId": DEMOHOSPB["participant"], "dataProductId": DEMOHOSPB["data_product"]},
        ],
        "notBefore": "2026-09-25T00:00:00.000Z",
        "notAfter": "2026-12-31T00:00:00.000Z",
    }
    token = login(DEMOHOSPB)
    status, body = request("POST", "/mdop/jobs/l15", payload, token)
    print("[l15:submit] http=%s %s" % (status, json.dumps(body, ensure_ascii=False)))
    if status not in (200, 201):
        raise SystemExit(1)
    job_id = body["jobId"]
    status, body = request("POST", "/mdop/jobs/%s/compile" % job_id, {}, token)
    print("[l15:compile] http=%s %s" % (status, json.dumps(body, ensure_ascii=False)))

    for _ in range(40):
        time.sleep(6)
        status, body = request("GET", "/mdop/jobs/%s" % job_id, None, token)
        job = (body or {}).get("job") or body
        print("[l15:poll] http=%s status=%s stages=%s" % (
            status,
            job.get("status"),
            [(s.get("id"), s.get("status")) for s in (job.get("stages") or [])],
        ))
        if job.get("status") in ("SUCCEEDED", "FAILED", "REJECTED", "COMPLETED"):
            print(json.dumps(job, ensure_ascii=False, indent=2))
            break


def cmd_job(job_id):
    token = login(DEMOHOSPB)
    status, body = request("GET", "/mdop/jobs/%s" % job_id, None, token)
    print("http=%s" % status)
    print(json.dumps(body, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "offer":
        cmd_offer()
    elif cmd == "status":
        cmd_status()
    elif cmd == "l15":
        cmd_l15()
    elif cmd == "job":
        cmd_job(sys.argv[2])
    else:
        raise SystemExit(__doc__)
