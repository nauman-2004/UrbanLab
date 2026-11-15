#!/usr/bin/env bash
# End-to-end demo over HTTP: create a study, follow the SSE stream, answer both
# approval gates, then fetch the dataset.
#
#   uv run uvicorn main:app --port 8000      # in another terminal
#   bash scripts/demo.sh                      # auto-approves everything
#   AUTO_APPROVE=0 bash scripts/demo.sh       # asks you y/n at each gate
#
# Needs: curl, python (only for JSON parsing).
set -euo pipefail

API="${API:-http://localhost:8000}"
QUESTION="${QUESTION:-Do older office buildings in Houston dedicate more land to surface parking?}"
AUTO_APPROVE="${AUTO_APPROVE:-1}"
PY="${PY:-python}"

json() { "$PY" -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'json': json}, {'d': d}))" "$1"; }

echo "==> POST /studies"
SID=$(curl -fsS -X POST "$API/studies" -H 'Content-Type: application/json' \
  -d "{\"question\": \"$QUESTION\"}" | json 'd["study_id"]')
echo "    study_id=$SID"
echo "==> GET /studies/$SID/events (SSE)"

curl -fsSN "$API/studies/$SID/events" | while IFS= read -r line; do
  [[ "$line" == data:* ]] || continue
  ev="${line#data: }"
  type=$(echo "$ev" | json 'd["type"]')
  case "$type" in
    cell_updated)
      echo "$ev" | json '"  cell     {building_id} {variable:<24} = {value!s:<8} [{source}, {status}] {evidence_ref}".format(**d["data"]["cell"])' ;;
    gap_detected)
      echo "$ev" | json '"  GAP      {building_id} {variable}: {reason}".format(**d["data"])' ;;
    approval_required)
      echo "$ev" | json '"\n  APPROVAL {action_id} ({kind}) {tool} {args}\n".format(**d["data"])'
      action_id=$(echo "$ev" | json 'd["data"]["action_id"]')
      approved=true
      if [[ "$AUTO_APPROVE" != "1" ]]; then
        read -r -p "  approve $action_id? [y/N] " ans </dev/tty
        [[ "$ans" =~ ^[Yy] ]] || approved=false
      fi
      curl -fsS -X POST "$API/studies/$SID/approve" -H 'Content-Type: application/json' \
        -d "{\"action_id\": \"$action_id\", \"approved\": $approved}" >/dev/null
      echo "  -> $action_id approved=$approved" ;;
    findings_ready)
      echo "$ev" | json '"\n  FINDINGS\n" + "\n".join("   - " + f for f in d["data"]["findings"]) + "\n  LIMITATIONS\n" + "\n".join("   - " + l for l in d["data"]["limitations"])' ;;
    study_completed|study_failed)
      echo "$ev" | json '"\n==> {}: {}".format(d["type"], d["data"].get("summary") or d["data"].get("error"))'
      break ;;
    *)
      echo "$ev" | json '"  {:<16} {}".format(d["type"], json.dumps(d["data"])[:160])' ;;
  esac
done

echo "==> GET /studies/$SID/dataset"
curl -fsS "$API/studies/$SID/dataset" | json '"    {} buildings, {} cells ({} filled, {} missing)".format(len(d["buildings"]), len(d["cells"]), sum(c["status"]=="filled" for c in d["cells"]), sum(c["status"]=="missing" for c in d["cells"]))'
echo "    full dataset also at backend/data/dataset.json"
