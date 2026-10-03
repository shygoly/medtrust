// tdx-sidecar — MedTrust 可信空间节点 / 校验方的 TDX 工具链 sidecar
// （tdx-attestation-pilot 任务 2.2 / 2.4 / 3.1；design P2 / P3）。
//
// Node.js 没有原生 TDX 工具链，节点进程与校验方进程都以子进程方式调用本工具，
// 一次调用一份 JSON（stdout），失败即非零退出 + {"ok":false,"error":...}。
//
// 子命令：
//   quote  -report-data <128hex>   TDVM 内：经 /dev/tdx_guest ioctl 取真实 quote，
//                                  并从 Intel PCS 取 collateral（PCK CRL + TCB Info）的摘要与时效。
//   verify                         校验域：stdin 读 {"quote_b64":...}，验签链到 Intel 证明根
//                                  （collateral 直取 Intel PCS + CRL 吊销检查），回报 quote 覆盖的
//                                  REPORTDATA / MRTD / TCB——调用方据此做协议字段比对。
//
// 度量与 TCB 的协议口径（两条子命令同源，校验方不信节点自报的值）：
//   measurement = "sm3:" + SM3(MR_TD 原始 48 字节)
//   tcb         = TEE_TCB_SVN 前三字节的点分十进制（如 05 01 03 → "5.1.3"）
//
// 构建：依赖 anolis/go-tdx-guest（含 tools/tdx-lab 的 ioctl provider），见同目录 build.sh。
package main

import (
	"bytes"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/google/go-tdx-guest/abi"
	"github.com/google/go-tdx-guest/pcs"
	pb "github.com/google/go-tdx-guest/proto/tdx"
	"github.com/google/go-tdx-guest/verify"
	"github.com/google/go-tdx-guest/verify/trust"
	"github.com/tjfoc/gmsm/sm3"
)

type collateralItem struct {
	Kind       string `json:"kind"`
	Digest     string `json:"digest"`
	FetchedAt  string `json:"fetched_at"`
	NextUpdate string `json:"next_update"`
}

type quoteFacts struct {
	ReportData  string `json:"report_data"`
	MrTd        string `json:"mr_td"`
	Measurement string `json:"measurement"`
	TeeTcbSvn   string `json:"tee_tcb_svn"`
	Tcb         string `json:"tcb"`
}

func fail(format string, a ...any) {
	out, _ := json.Marshal(map[string]any{"ok": false, "error": fmt.Sprintf(format, a...)})
	fmt.Println(string(out))
	os.Exit(1)
}

func emit(v map[string]any) {
	v["ok"] = true
	out, err := json.Marshal(v)
	if err != nil {
		fail("marshal: %v", err)
	}
	fmt.Println(string(out))
}

func sm3Label(b []byte) string { return "sm3:" + hex.EncodeToString(sm3.Sm3Sum(b)) }

func parseQuote(raw []byte) (*pb.QuoteV5, quoteFacts) {
	protoAny, err := abi.QuoteToProto(raw)
	if err != nil {
		fail("parse quote: %v", err)
	}
	q, ok := protoAny.(*pb.QuoteV5)
	if !ok {
		fail("不支持的 quote 版本：%T（本工具只认 V5）", protoAny)
	}
	body := q.GetTdQuoteBodyDescriptor().GetTdQuoteBodyV5()
	rd, mrtd, svn := body.GetReportData(), body.GetMrTd(), body.GetTeeTcbSvn()
	if len(rd) != 64 || len(mrtd) != 48 || len(svn) < 3 {
		fail("quote body 字段长度异常：report_data=%d mr_td=%d tee_tcb_svn=%d", len(rd), len(mrtd), len(svn))
	}
	return q, quoteFacts{
		ReportData:  hex.EncodeToString(rd),
		MrTd:        hex.EncodeToString(mrtd),
		Measurement: sm3Label(mrtd),
		TeeTcbSvn:   hex.EncodeToString(svn),
		Tcb:         fmt.Sprintf("%d.%d.%d", svn[0], svn[1], svn[2]),
	}
}

// PCK 叶证书随 quote 一起给出（认证数据里的 PEM 链），FMSPC 在其 SGX 扩展里。
func fmspcFromQuote(raw []byte) string {
	start := bytes.Index(raw, []byte("-----BEGIN CERTIFICATE-----"))
	if start < 0 {
		fail("quote 内未找到 PCK 证书链")
	}
	block, _ := pem.Decode(raw[start:])
	if block == nil {
		fail("PCK 证书 PEM 解析失败")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		fail("PCK 证书解析失败：%v", err)
	}
	ext, err := pcs.PckCertificateExtensions(cert)
	if err != nil {
		fail("PCK 证书扩展解析失败：%v", err)
	}
	return ext.FMSPC
}

func fetch(getter trust.HTTPSGetter, url string) []byte {
	_, body, err := getter.Get(url)
	if err != nil {
		fail("取 collateral 失败（%s）：%v", url, err)
	}
	return body
}

// Intel PCS v4 的 CRL 可能是 DER，也可能是十六进制编码的 DER。
func crlNextUpdate(body []byte) time.Time {
	der := body
	if decoded, err := hex.DecodeString(strings.TrimSpace(string(body))); err == nil {
		der = decoded
	}
	crl, err := x509.ParseRevocationList(der)
	if err != nil {
		fail("PCK CRL 解析失败：%v", err)
	}
	return crl.NextUpdate
}

func fetchCollateral(raw []byte) []collateralItem {
	getter := trust.DefaultHTTPSGetter()
	now := time.Now().UTC().Format(time.RFC3339)

	crl := fetch(getter, pcs.PckCrlURL("platform"))
	tcbBody := fetch(getter, pcs.TcbInfoURL(fmspcFromQuote(raw)))
	var tcb pcs.TdxTcbInfo
	if err := json.Unmarshal(tcbBody, &tcb); err != nil {
		fail("TCB Info 解析失败：%v", err)
	}
	return []collateralItem{
		{Kind: "crl", Digest: sm3Label(crl), FetchedAt: now, NextUpdate: crlNextUpdate(crl).UTC().Format(time.RFC3339)},
		{Kind: "qvl", Digest: sm3Label(tcbBody), FetchedAt: now, NextUpdate: tcb.TcbInfo.NextUpdate.UTC().Format(time.RFC3339)},
	}
}

func doQuote(reportDataHex string) {
	rd, err := hex.DecodeString(reportDataHex)
	if err != nil || len(rd) != 64 {
		fail("-report-data 必须是 64 字节（128 位十六进制）")
	}
	var reportData [64]byte
	copy(reportData[:], rd)

	p, err := NewIoctlProvider()
	if err != nil {
		fail("打开 /dev/tdx_guest 失败（不在 TDVM 内？）：%v", err)
	}
	defer p.Close()
	t0 := time.Now()
	raw, err := p.GetQuote(reportData)
	if err != nil {
		fail("取 quote 失败（MUST NOT 降级为软件报告）：%v", err)
	}
	quoteMs := time.Since(t0).Milliseconds()

	_, facts := parseQuote(raw)
	if facts.ReportData != hex.EncodeToString(rd) {
		fail("quote 覆盖的 REPORTDATA 与请求不一致")
	}
	emit(map[string]any{
		"quote_b64":  base64.StdEncoding.EncodeToString(raw),
		"facts":      facts,
		"collateral": fetchCollateral(raw),
		"t_quote_ms": quoteMs,
	})
}

func doVerify() {
	in, err := io.ReadAll(os.Stdin)
	if err != nil {
		fail("read stdin: %v", err)
	}
	var req struct {
		QuoteB64 string `json:"quote_b64"`
	}
	if err := json.Unmarshal(in, &req); err != nil || req.QuoteB64 == "" {
		fail("stdin 需为 {\"quote_b64\": ...}")
	}
	raw, err := base64.StdEncoding.DecodeString(req.QuoteB64)
	if err != nil {
		fail("quote_b64 不是合法 base64")
	}
	q, facts := parseQuote(raw)

	// 验签链到 Intel 证明根：collateral 直取 Intel PCS（阿里云北京 PCCS 的 tcbInfo 实测已过期，
	// 见 tdx-attestation-pilot RECORD §3.1），并做 CRL 吊销检查。
	// TCB 状态：阿里云不承诺 UpToDate（实测 OutOfDate），故显式列出接受的状态；吊销态不在其列。
	opts := verify.DefaultOptions()
	opts.GetCollateral = true
	opts.CheckRevocations = true
	opts.Getter = trust.DefaultHTTPSGetter()
	opts.AcceptedTCBStatuses = []pcs.TcbComponentStatus{
		pcs.TcbComponentStatusUpToDate,
		pcs.TcbComponentStatusSwHardeningNeeded,
		pcs.TcbComponentStatusConfigurationNeeded,
		pcs.TcbComponentStatusConfigurationAndSWHardeningNeeded,
		pcs.TcbComponentStatusOutOfDate,
		pcs.TcbComponentStatusOutOfDateConfigurationNeeded,
	}
	t0 := time.Now()
	if err := verify.TdxQuote(q, opts); err != nil {
		fail("验签失败：链未验到 Intel 证明根（fail-closed）：%v", err)
	}
	emit(map[string]any{
		"facts":       facts,
		"chain":       "intel-sgx-root-ca",
		"collateral":  "intel-pcs",
		"verified_at": time.Now().UTC().Format(time.RFC3339),
		"t_verify_ms": time.Since(t0).Milliseconds(),
	})
}

func main() {
	if len(os.Args) < 2 {
		fail("用法：tdx-sidecar <quote -report-data HEX | verify>")
	}
	switch os.Args[1] {
	case "quote":
		fs := flag.NewFlagSet("quote", flag.ExitOnError)
		rd := fs.String("report-data", "", "64 字节 REPORTDATA（128 位十六进制）")
		fs.Parse(os.Args[2:])
		doQuote(*rd)
	case "verify":
		doVerify()
	default:
		fail("未知子命令：%s", os.Args[1])
	}
}
