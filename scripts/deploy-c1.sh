#!/usr/bin/env bash

set -euo pipefail

KUBE_CONTEXT="${KUBE_CONTEXT:-c1}"
KUBE_NAMESPACE="${KUBE_NAMESPACE:-ml}"
POD_NAME="${POD_NAME:-gpu-crunch-publisher-$(date '+%Y%m%d%H%M%S')}"
PUBLISH_IMAGE="${PUBLISH_IMAGE:-alpine:3.20}"
TARGET_DIR="${TARGET_DIR:-/mnt/home/mark/games/gpu-crunch}"
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" delete pod "$POD_NAME" --ignore-not-found=true >/dev/null 2>&1 || true
}

trap cleanup EXIT

cd "$ROOT_DIR"

npm run build

kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" delete pod "$POD_NAME" --ignore-not-found=true >/dev/null 2>&1 || true
kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" run "$POD_NAME" \
  --image="$PUBLISH_IMAGE" \
  --restart=Never \
  --overrides='{"apiVersion":"v1","spec":{"containers":[{"name":"publisher","image":"alpine:3.20","command":["sh","-lc","sleep 3600"],"volumeMounts":[{"name":"home","mountPath":"/mnt/home"}]}],"volumes":[{"name":"home","persistentVolumeClaim":{"claimName":"c1-home"}}]}}' \
  >/dev/null

kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" wait --for=condition=Ready "pod/${POD_NAME}" --timeout=120s >/dev/null
kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" exec "$POD_NAME" -- sh -lc "rm -rf '$TARGET_DIR' && mkdir -p '$TARGET_DIR'"
COPYFILE_DISABLE=1 tar --null -T <(git ls-files -z) -czf - | kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" exec -i "$POD_NAME" -- sh -lc "tar -C '$TARGET_DIR' -xzf - && find '$TARGET_DIR' -name '._*' -delete"

kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" apply -f "$ROOT_DIR/deployment/c1/gpu-crunch.yaml"
kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" rollout restart deploy/gpu-crunch
kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" rollout status deploy/gpu-crunch --timeout=180s
kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NAMESPACE" get svc gpu-crunch
