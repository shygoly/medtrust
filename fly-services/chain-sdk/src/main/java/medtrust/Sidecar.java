package medtrust;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.chainmaker.pb.common.ContractOuterClass;
import org.chainmaker.pb.common.Request;
import org.chainmaker.pb.common.ResultOuterClass;
import org.chainmaker.sdk.ChainClient;
import org.chainmaker.sdk.ChainManager;
import org.chainmaker.sdk.User;
import org.chainmaker.sdk.config.ChainClientConfig;
import org.chainmaker.sdk.config.NodeConfig;
import org.chainmaker.sdk.config.Pkcs11Config;
import org.chainmaker.sdk.config.RpcClientConfig;
import org.chainmaker.sdk.config.SdkConfig;
import org.chainmaker.sdk.utils.FileUtils;
import org.chainmaker.sdk.utils.SdkUtils;
import org.web3j.abi.FunctionEncoder;
import org.web3j.abi.datatypes.Function;
import org.web3j.abi.datatypes.Type;
import org.web3j.abi.datatypes.Utf8String;
import org.web3j.abi.datatypes.generated.Bytes32;
import org.web3j.abi.datatypes.generated.Uint256;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Thin HTTP gateway over ChainMaker Java SDK. It preserves the previous FISCO
 * sidecar HTTP contract so the NestJS API does not need to know which chain is
 * behind the gateway.
 */
public class Sidecar {
    static final long RPC_TIMEOUT_MS = Long.parseLong(env("CHAIN_RPC_TIMEOUT_MS", "10000"));
    static final long SYNC_TIMEOUT_MS = Long.parseLong(env("CHAIN_SYNC_TIMEOUT_MS", "20000"));
    static final String CONTRACT_NAME = env("CHAIN_CONTRACT_NAME", "medical_data_attestation");

    static ChainClient client;
    static volatile boolean ready = false;
    static volatile String initError = "starting";

    public static void main(String[] args) throws Exception {
        int port = Integer.parseInt(env("SIDECAR_PORT", "8090"));
        HttpServer server = HttpServer.create(new InetSocketAddress("::", port), 0);
        server.createContext("/health", Sidecar::handleHealth);
        server.createContext("/block-number", Sidecar::handleBlockNumber);
        server.createContext("/attest", Sidecar::handleAttest);
        server.createContext("/attestation", Sidecar::handleGetAttestation);
        server.createContext("/attestations", Sidecar::handleListAttestations);
        server.setExecutor(java.util.concurrent.Executors.newFixedThreadPool(8));
        server.start();
        System.out.println("[sidecar] HTTP listening on 0.0.0.0:" + port);

        new Thread(Sidecar::initChain, "chain-init").start();
    }

    static void initChain() {
        try { Thread.sleep(Long.parseLong(env("CHAIN_BOOT_DELAY_MS", "15000"))); }
        catch (InterruptedException ignored) { return; }

        for (int attempt = 1; ; attempt++) {
            try {
                client = createClient();
                String version = client.getChainMakerServerVersion(RPC_TIMEOUT_MS);
                long block = client.getCurrentBlockHeight(RPC_TIMEOUT_MS);
                deployContract();
                ready = true;
                initError = null;
                System.out.println("[sidecar] chain ready version=" + version + " block=" + block + " contract=" + CONTRACT_NAME);
                return;
            } catch (Throwable t) {
                initError = t.getMessage();
                System.out.println("[sidecar] init attempt " + attempt + " failed: " + t);
                try { Thread.sleep(5000); } catch (InterruptedException ignored) { return; }
            }
        }
    }

    static ChainClient createClient() throws Exception {
        String configDir = env("CHAIN_CONFIG_DIR", "/chainmaker-go/config/wx-org-solo");
        String orgId = env("CHAIN_ORG_ID", "wx-org.chainmaker.org");
        String userDir = configDir + "/certs/" + orgId + "/user/client1";
        String caDir = configDir + "/certs/" + orgId + "/ca";

        NodeConfig node = new NodeConfig();
        node.setNodeAddr(env("CHAIN_RPC_PEER", "127.0.0.1:12301"));
        node.setConnCnt(1);
        node.setEnableTls(true);
        node.setTlsHostName(env("CHAIN_TLS_HOST", "chainmaker.org"));
        node.setTrustRootPaths(new String[]{caDir});
        node.setTrustRootBytes(FileUtils.getFilesByPath(caDir).stream().map(file -> {
            try { return FileUtils.getFileBytes(file); }
            catch (Exception e) { throw new RuntimeException(e); }
        }).toArray(byte[][]::new));

        RpcClientConfig rpc = new RpcClientConfig();
        rpc.setMaxReceiveMessageSize(16);

        Pkcs11Config pkcs11 = new Pkcs11Config();
        pkcs11.setEnabled(false);

        ChainClientConfig chain = new ChainClientConfig();
        chain.setChainId(env("CHAIN_ID", "chain1"));
        chain.setOrgId(orgId);
        chain.setAuthType("permissionedWithCert");
        chain.setRetryLimit(3);
        chain.setRetryInterval(500);
        chain.setEnableTxResultDispatcher(false);
        chain.setUserKeyBytes(FileUtils.getFileBytes(userDir + "/client1.tls.key"));
        chain.setUserCrtBytes(FileUtils.getFileBytes(userDir + "/client1.tls.crt"));
        chain.setUserSignKeyBytes(FileUtils.getFileBytes(userDir + "/client1.sign.key"));
        chain.setUserSignCrtBytes(FileUtils.getFileBytes(userDir + "/client1.sign.crt"));
        chain.setNodes(new NodeConfig[]{node});
        chain.setRpcClient(rpc);
        chain.setPkcs11(pkcs11);

        SdkConfig config = new SdkConfig();
        config.setChainClient(chain);

        ChainManager manager = ChainManager.getInstance();
        ChainClient existing = manager.getChainClient(chain.getChainId());
        return existing == null ? manager.createChainClient(config) : existing;
    }

    static void deployContract() throws Exception {
        String preset = System.getenv("CHAIN_CONTRACT_ADDRESS");
        if (preset != null && !preset.isBlank()) {
            return;
        }
        Path bin = Path.of(env("CHAIN_CONTRACT_BIN", "/app/contract/MedicalDataAttestation.bin"));
        byte[] byteCode = Files.readString(bin).trim().getBytes(StandardCharsets.UTF_8);
        Request.Payload payload = client.createContractCreatePayload(
                CONTRACT_NAME,
                env("CHAIN_CONTRACT_VERSION", "1.0.0"),
                byteCode,
                ContractOuterClass.RuntimeType.EVM,
                null
        );
        User admin = adminUser();
        Request.EndorsementEntry[] endorsers = SdkUtils.getEndorsers(payload, new User[]{admin});
        ResultOuterClass.TxResponse response = client.sendContractManageRequest(payload, endorsers, RPC_TIMEOUT_MS, SYNC_TIMEOUT_MS);
        if (!"OK".equals(response.getMessage()) || response.getContractResult().getCode() != 0) {
            throw new IllegalStateException("contract deploy failed: " + response);
        }
    }

    static User adminUser() throws Exception {
        String configDir = env("CHAIN_CONFIG_DIR", "/chainmaker-go/config/wx-org-solo");
        String orgId = env("CHAIN_ORG_ID", "wx-org.chainmaker.org");
        String dir = configDir + "/certs/" + orgId + "/user/admin1";
        return new User(
                orgId,
                FileUtils.getFileBytes(dir + "/admin1.sign.key"),
                FileUtils.getFileBytes(dir + "/admin1.sign.crt"),
                FileUtils.getFileBytes(dir + "/admin1.tls.key"),
                FileUtils.getFileBytes(dir + "/admin1.tls.crt"),
                false
        );
    }

    static void handleHealth(HttpExchange ex) throws IOException {
        if (ready) {
            long bn = 0;
            try { bn = client.getCurrentBlockHeight(RPC_TIMEOUT_MS); } catch (Exception ignored) {}
            send(ex, 200, "{\"status\":\"ok\",\"ready\":true,\"blockNumber\":" + bn
                    + ",\"contract\":" + jstr(CONTRACT_NAME) + "}");
        } else {
            send(ex, 200, "{\"status\":\"initializing\",\"ready\":false,\"error\":" + jstr(initError) + "}");
        }
    }

    static void handleBlockNumber(HttpExchange ex) throws IOException {
        if (!ready) { send(ex, 503, "{\"error\":\"chain not ready\"}"); return; }
        try {
            send(ex, 200, "{\"blockNumber\":" + client.getCurrentBlockHeight(RPC_TIMEOUT_MS) + "}");
        } catch (Exception e) {
            send(ex, 500, "{\"error\":" + jstr(e.getMessage()) + "}");
        }
    }

    static void handleAttest(HttpExchange ex) throws IOException {
        if (!"POST".equals(ex.getRequestMethod())) { send(ex, 405, "{\"error\":\"POST only\"}"); return; }
        if (!ready) { send(ex, 503, "{\"error\":\"chain not ready\"}"); return; }
        try {
            String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            String dataHash = jget(body, "dataHash");
            String dataType = orElse(jget(body, "dataType"), "data_sharing");
            String metadata = orElse(jget(body, "metadata"), "{}");
            if (dataHash == null || dataHash.isBlank()) { send(ex, 400, "{\"error\":\"dataHash required\"}"); return; }

            ResultOuterClass.TxResponse resp = client.invokeContract(CONTRACT_NAME, "storeAttestation", null, evmData(
                    "storeAttestation",
                    List.of(new Bytes32(toBytes32(dataHash)), new Utf8String(dataType), new Utf8String(metadata))
            ), RPC_TIMEOUT_MS, SYNC_TIMEOUT_MS);

            int resultCode = resp.getContractResult().getCode();
            int status = resultCode == 0 ? 0 : 1;
            long block = 0;
            try { block = client.getBlockHeightByTxId(resp.getTxId(), RPC_TIMEOUT_MS); } catch (Exception ignored) {}
            send(ex, 200, "{\"txHash\":\"" + resp.getTxId() + "\",\"blockNumber\":\"" + block
                    + "\",\"status\":" + status + ",\"contract\":" + jstr(CONTRACT_NAME) + "}");
        } catch (Exception e) {
            send(ex, 500, "{\"error\":" + jstr(e.getMessage()) + "}");
        }
    }

    // GET /attestation/{hash} — read the on-chain attestation for a data hash.
    // Queries the EVM contract view `getAttestationByHash(bytes32)` and decodes
    // the ABI struct head (attester / timestamp / exists); no write, no mock.
    static void handleGetAttestation(HttpExchange ex) throws IOException {
        if (!"GET".equals(ex.getRequestMethod())) { send(ex, 405, "{\"error\":\"GET only\"}"); return; }
        if (!ready) { send(ex, 503, "{\"error\":\"chain not ready\"}"); return; }
        String path = ex.getRequestURI().getPath(); // "/attestation/<hash>"
        int i = path.lastIndexOf('/');
        String hash = (i >= 0 && i + 1 < path.length()) ? path.substring(i + 1) : "";
        if (hash.isBlank()) { send(ex, 400, "{\"error\":\"hash required\"}"); return; }
        try {
            ResultOuterClass.TxResponse resp = client.queryContract(
                    CONTRACT_NAME, "getAttestationByHash",
                    evmData("getAttestationByHash", List.of(new Bytes32(toBytes32(hash)))),
                    RPC_TIMEOUT_MS);
            byte[] r = resp.getContractResult().getResult().toByteArray();
            // ABI struct head: [0..32] dataHash, [32..64] dataType offset,
            // [64..96] address attester, [96..128] uint256 timestamp,
            // [128..160] metadata offset, [160..192] bool exists.
            if (r.length < 192) { send(ex, 200, "{\"exists\":false}"); return; }
            boolean exists = r[191] != 0;
            if (!exists) { send(ex, 200, "{\"exists\":false}"); return; }
            long timestamp = toLong(r, 120); // uint256 low 8 bytes (Unix ts fits)
            String attester = toHex(r, 76, 20); // address right-aligned in 32-byte word
            send(ex, 200, "{\"exists\":true,\"timestamp\":" + timestamp
                    + ",\"attester\":\"0x" + attester + "\",\"dataHash\":" + jstr(hash) + "}");
        } catch (Exception e) {
            send(ex, 500, "{\"error\":" + jstr(e.getMessage()) + "}");
        }
    }

    // GET /attestations — enumerate on-chain attestations via count + byId.
    static void handleListAttestations(HttpExchange ex) throws IOException {
        if (!"GET".equals(ex.getRequestMethod())) { send(ex, 405, "{\"error\":\"GET only\"}"); return; }
        if (!ready) { send(ex, 503, "{\"error\":\"chain not ready\"}"); return; }
        try {
            ResultOuterClass.TxResponse cResp = client.queryContract(
                    CONTRACT_NAME, "getAttestationCount",
                    evmData("getAttestationCount", List.of()), RPC_TIMEOUT_MS);
            byte[] c = cResp.getContractResult().getResult().toByteArray();
            long count = c.length >= 32 ? toLong(c, 24) : 0;
            StringBuilder sb = new StringBuilder("{\"attestations\":[");
            boolean first = true;
            for (long n = 1; n <= count; n++) {
                ResultOuterClass.TxResponse resp = client.queryContract(
                        CONTRACT_NAME, "getAttestationById",
                        evmData("getAttestationById", List.of(new Uint256(BigInteger.valueOf(n)))),
                        RPC_TIMEOUT_MS);
                byte[] r = resp.getContractResult().getResult().toByteArray();
                if (r.length < 192 || r[191] == 0) continue;
                if (!first) sb.append(',');
                first = false;
                sb.append("{\"dataHash\":\"0x").append(toHex(r, 0, 32))
                  .append("\",\"attester\":\"0x").append(toHex(r, 76, 20))
                  .append("\",\"timestamp\":").append(toLong(r, 120)).append("}");
            }
            sb.append("]}");
            send(ex, 200, sb.toString());
        } catch (Exception e) {
            send(ex, 500, "{\"error\":" + jstr(e.getMessage()) + "}");
        }
    }

    static long toLong(byte[] b, int off) {
        long v = 0;
        for (int k = 0; k < 8; k++) v = (v << 8) | (b[off + k] & 0xffL);
        return v;
    }

    static String toHex(byte[] b, int off, int len) {
        StringBuilder sb = new StringBuilder(len * 2);
        for (int k = 0; k < len; k++) sb.append(String.format("%02x", b[off + k] & 0xff));
        return sb.toString();
    }

    static Map<String, byte[]> evmData(String method, List<Type> inputs) {
        String encoded = FunctionEncoder.encode(new Function(method, inputs, Collections.emptyList()));
        String hex = encoded.startsWith("0x") ? encoded.substring(2) : encoded;
        return Map.of("data", hex.getBytes(StandardCharsets.UTF_8));
    }

    static byte[] toBytes32(String hex) {
        String h = hex.startsWith("0x") ? hex.substring(2) : hex;
        if (h.length() > 64) h = h.substring(0, 64);
        while (h.length() < 64) h = h + "0";
        byte[] out = new byte[32];
        for (int i = 0; i < 32; i++) out[i] = (byte) Integer.parseInt(h.substring(i * 2, i * 2 + 2), 16);
        return out;
    }

    static String env(String k, String d) { String v = System.getenv(k); return (v == null || v.isBlank()) ? d : v; }
    static String orElse(String v, String d) { return (v == null || v.isBlank()) ? d : v; }

    static String jget(String json, String key) {
        String pat = "\"" + key + "\"";
        int i = json.indexOf(pat);
        if (i < 0) return null;
        i = json.indexOf(':', i + pat.length());
        if (i < 0) return null;
        int j = i + 1;
        while (j < json.length() && Character.isWhitespace(json.charAt(j))) j++;
        if (j < json.length() && json.charAt(j) == '"') {
            j++; StringBuilder sb = new StringBuilder();
            while (j < json.length() && json.charAt(j) != '"') {
                if (json.charAt(j) == '\\' && j + 1 < json.length()) { sb.append(json.charAt(j + 1)); j += 2; }
                else { sb.append(json.charAt(j)); j++; }
            }
            return sb.toString();
        }
        return null;
    }

    static String jstr(String s) {
        if (s == null) return "null";
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ") + "\"";
    }

    static void send(HttpExchange ex, int code, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json");
        ex.sendResponseHeaders(code, b.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(b); }
    }
}
