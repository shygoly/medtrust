#!/usr/bin/env bash
# WebBridge E2E screenshot runner for docs/demo/federated-e2e-test.md
set -euo pipefail
SESSION=medtrust-e2e-doc
BASE="/Users/mac/Sync/project/medtrust/docs/demo/screenshots"
API="http://127.0.0.1:10086/command"
WEB="https://medtrust-web.fly.dev"

wb() {
  local action="$1"
  local args="$2"
  curl -s -X POST "$API" -H 'Content-Type: application/json' \
    -d "{\"action\":\"$action\",\"args\":$args,\"session\":\"$SESSION\"}"
}

eval_js() {
  local code="$1"
  python3 -c "import json,sys; print(json.dumps({'action':'evaluate','args':{'code':sys.stdin.read()},'session':'$SESSION'}))" <<< "$code" | curl -s -X POST "$API" -H 'Content-Type: application/json' -d @- | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('value',''))"
}

shot() {
  local path="$1"
  wb screenshot "{\"format\":\"png\",\"path\":\"$path\",\"scale\":\"css\",\"type\":\"png\"}" >/dev/null
  echo "screenshot: $path"
}

click_text() {
  local text="$1"
  eval_js "(() => { const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('$text')); if(!b) return 'MISSING:$text'; b.click(); return 'clicked:$text'; })()"
}

echo "=== 0 login provider ==="
wb navigate "{\"url\":\"$WEB/login\",\"newTab\":true,\"group_title\":\"FedAvg E2E 文档截图\"}" >/dev/null
sleep 2
click_text "华山医院" >/dev/null
sleep 3
shot "$BASE/01-login-provider.png"

echo "=== 1 catalog ==="
wb navigate "{\"url\":\"$WEB/space/catalog\"}" >/dev/null
sleep 2
shot "$BASE/02-catalog-train-button.png"

echo "=== 2 train ==="
click_text "连接器训练"
for i in $(seq 1 90); do
  msg=$(eval_js "(() => { const s=[...document.querySelectorAll('span')].map(x=>x.innerText).find(t=>t.includes('联邦')||t.includes('失败')||t.includes('训练')); return s||''; })()")
  if echo "$msg" | grep -q "联邦 LoRA"; then
    echo "train done: $msg"
    break
  fi
  if echo "$msg" | grep -q "失败"; then
    echo "train failed: $msg"
    exit 1
  fi
  sleep 2
done
sleep 1
shot "$BASE/03-catalog-training-done.png"

TASK_ID=$(eval_js "(() => { const t=[...document.querySelectorAll('span')].map(x=>x.innerText).join(' '); const m=t.match(/catalog-fl-\\d+/); return m?m[0]:''; })()")
if [ -z "$TASK_ID" ]; then
  TASK_ID=$(eval_js "(async () => { const token=localStorage.getItem('medtrust_token'); const r=await fetch('https://medtrust-api.fly.dev/api/v1/secretflow/tasks',{headers:{Authorization:'Bearer '+token}}); const j=await r.json(); const hit=j.filter(x=>x.taskId.startsWith('catalog-fl-')).sort((a,b)=>b.taskId.localeCompare(a.taskId))[0]; return hit?hit.taskId:''; })()")
fi
echo "taskId=$TASK_ID"
if [ -z "$TASK_ID" ]; then
  echo "could not resolve taskId"
  exit 1
fi

echo "=== 3 federated detail ==="
wb navigate "{\"url\":\"$WEB/space/federated/$TASK_ID\"}" >/dev/null
sleep 4
shot "$BASE/04-federated-detail-provider.png"

echo "=== 4 consumer ==="
wb navigate "{\"url\":\"$WEB/login\"}" >/dev/null
sleep 2
click_text "恒瑞医药" >/dev/null
sleep 3
wb navigate "{\"url\":\"$WEB/space/deliverables\"}" >/dev/null
sleep 2
shot "$BASE/05-login-consumer.png"

echo "=== 5 deliverable ==="
wb navigate "{\"url\":\"$WEB/space/deliverables/$TASK_ID\"}" >/dev/null
sleep 3
shot "$BASE/06-deliverable-download.png"

echo "=== done taskId=$TASK_ID ==="
