import { parseOperatorManifest } from "@medtrust/mdop";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { CaService } from "../runtime/participant-identity/ca.service";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { AlgorithmModuleRegistry } from "../runtime/connector-modules/algorithm-module.registry";
import { MdopOperatorRegistryService } from "./operator-registry.service";

describe("去重人数算子登记（C2 T6）", () => {
  it("按声明形状登记为 wasm（tee / C2 投影 / 可复现构建）", async () => {
    const gm = new GMCryptoService();
    const ca = new CaService(gm, mockRepo(), mockRepo(), "sh-med");
    await ca.onModuleInit();
    const declared = {
      analysisType: "distinct-count",
      file: "distinct-count.wasm",
      abiVersion: 1,
      sm3: "e".repeat(64),
      compiler: { name: "assemblyscript", version: "0.27.37" },
      operator: {
        id: "rws.distinct-count",
        version: "1.0.0",
        category: "local",
        environments: ["tee"],
        inputs: [
          {
            name: "dataset",
            schema: "mdop.projection/1.0",
            accept_labels: ["C2"],
          },
        ],
        outputs: [
          {
            name: "counts",
            schema: "rws.distinct-count/1.0",
            label_rule: "inherit",
          },
        ],
      },
    };
    const svc = new MdopOperatorRegistryService(
      gm,
      ca,
      mockRepo(),
      mockRepo(),
      {
        list: () => [declared],
      } as unknown as AlgorithmModuleRegistry,
    );
    await svc.onModuleInit();
    const rows = await svc.list();
    const counted = rows.find(
      (r: { ref: string }) => r.ref === "rws.distinct-count@1.0.0",
    );
    expect(counted).toBeDefined();
    expect(counted.kind).toBe("wasm");
    expect(counted.digest).toBe(`sm3:${"e".repeat(64)}`);
    const manifest = parseOperatorManifest(counted.manifest);
    expect(manifest.category).toBe("local");
    expect(manifest.environments).toEqual(["tee"]);
    expect(manifest.inputs[0].accept_labels).toEqual(["C2"]);
    expect(manifest.build?.reproducible).toBe(true);
  });
});
