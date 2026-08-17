#!/usr/bin/env bash
# 生成西安节点三方应用 SM2 密钥对（PDF §4.3）。
# 输出：
#   XIAN_SM2_PRIVATE_KEY_PKCS8_B64  我方私钥（PKCS#8 DER Base64，存 .env / fly secrets）
#   XIAN_SM2_PUBLIC_KEY_SPKI_B64    公钥（X.509 SPKI Base64，上传能力中心，不含 PEM 头尾）
set -euo pipefail

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

openssl ecparam -genkey -name SM2 -out "$TMP/priv.pem"
openssl pkcs8 -topk8 -nocrypt -in "$TMP/priv.pem" -outform DER -out "$TMP/priv.der"
openssl ec -in "$TMP/priv.pem" -pubout -outform DER -out "$TMP/pub.der"

echo "XIAN_SM2_PRIVATE_KEY_PKCS8_B64=$(base64 < "$TMP/priv.der" | tr -d '\n')"
echo "XIAN_SM2_PUBLIC_KEY_SPKI_B64=$(base64 < "$TMP/pub.der" | tr -d '\n')"
echo "# 将上面公钥 Base64 原文（不含 PEM 头尾）上传到西安节点能力中心「添加应用」表单。"
