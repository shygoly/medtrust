import { CKD_PURPOSE, SECRETFLOW_SPEC } from "@medtrust/demo-scenario";

/** Consumer-facing copy for the CKD federated LoRA deliverable (demo scenario). */
export const CKD_MODEL_BRIEF = {
  title: "CKD 进展 · ESRD 风险分层联邦 LoRA 模型",
  purpose: CKD_PURPOSE,
  purposeLabel: "慢性肾病进展与终末期肾病(ESRD)风险预测",
  backbone: {
    name: SECRETFLOW_SPEC.llmBackbone.modelNameOrPath,
    type: SECRETFLOW_SPEC.llmBackbone.modelType,
    description:
      "基于医疗领域预训练大模型 Meditron-7B,在各家医院本地结构化 EHR 特征上进行 LoRA 低秩微调,学习肾病进展相关表征,不汇聚原始病历。",
  },
  peft: {
    type: SECRETFLOW_SPEC.peftStrategy.type.toUpperCase(),
    rank: SECRETFLOW_SPEC.peftStrategy.r,
    alpha: SECRETFLOW_SPEC.peftStrategy.alpha,
    targets: SECRETFLOW_SPEC.peftStrategy.targetModules,
    description:
      "LoRA 仅更新注意力层少量参数(r=8),显著降低跨院传输与存储成本;联邦合并后得到统一的 delta 指纹(loraDeltaHash)。",
  },
  dataModalities: ["structured_ehr"],
  dataNote:
    "训练数据为各 connector 本地路径下的脱敏 FHIR/Synthea 队列;原始患者记录不出域,您收到的是经输出闸门放行的安全制品。",
  privacy: {
    tee: SECRETFLOW_SPEC.privacy.teeRequired,
    dpSgd: SECRETFLOW_SPEC.privacy.dpSgd,
    summary: "本地 TEE/机密计算环境训练 + DP-SGD 梯度裁剪与噪声;仅允许 lora_delta_hash、aggregate_metrics 等制品回传。",
  },
  allowedArtifacts: SECRETFLOW_SPEC.outputPolicy.allowedArtifacts,
  intendedUse: [
    "作为真实世界研究(RWE)中「模型已按合约训练完成」的密码学凭据,与链上存证、数字合约对账。",
    "下载 encrypted_delta_ref 对应的 SM2 信封加密 LoRA 包,在药企侧用机构私钥解密,并用 loraDeltaHash 校验完整性。",
    "结合 aggregate_metrics 评估是否满足上线或扩展训练轮次的质量门槛(非诊断结论,需内部验证)。",
  ],
  notIncluded: [
    "任何可识别个人的 FHIR 行级记录或影像 DICOM 文件。",
    "LoRA 权重明文(仅提供国密信封加密包;解密需在药企安全区进行)。",
    "单院局部模型——交付物为华山 + 瑞金等多院联邦合并后的统一 adapter。",
  ],
} as const;

export function artifactLabel(kind: string): string {
  const map: Record<string, string> = {
    lora_delta_hash: "联邦 LoRA 增量哈希",
    encrypted_delta_ref: "加密 LoRA 增量(SM2 信封)",
    aggregate_metrics: "聚合训练指标",
    attestation_report: "运行存证报告",
  };
  return map[kind] ?? kind;
}
