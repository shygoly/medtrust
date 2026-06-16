import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Activity,
  Blocks,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Database,
  FileText,
  GitBranch,
  Hospital,
  Layers3,
  Lock,
  Network,
  Server,
  Shield,
} from 'lucide-react';

export const metadata: Metadata = {
  title: '技术文档 | MedTrust',
  description: 'MedTrust 医疗可信数据空间的隐私计算、联邦学习、联盟链和医疗数据标准说明文档。',
};

const navItems = [
  { href: '#architecture', label: '系统架构' },
  { href: '#secretflow', label: 'SecretFlow' },
  { href: '#fate', label: 'FATE 联邦学习' },
  { href: '#privacy-computing', label: '隐私计算' },
  { href: '#standards', label: '医疗标准' },
  { href: '#frameworks', label: '框架对比' },
];

const knowledgeCards = [
  {
    id: 'fate',
    icon: BrainCircuit,
    title: '联邦学习 FATE',
    label: 'Federated AI Technology Enabler',
    description:
      'FATE 是微众银行开源的工业级联邦学习平台，支持横向联邦、纵向联邦、联邦迁移学习、隐私求交、联邦特征工程和安全聚合。它适合多机构之间联合建模，但不交换原始样本。',
    bullets: [
      '横向联邦适合多家医院拥有相似字段但患者不同的场景，例如多中心疾病预测。',
      '纵向联邦适合机构之间样本有交集但特征不同的场景，例如医院诊疗数据与药企随访数据联合分析。',
      '通过 PSI、同态加密、安全聚合等机制降低样本标识和模型更新泄露风险。',
    ],
  },
  {
    id: 'mpc',
    icon: Lock,
    title: '多方安全计算',
    label: 'Secure Multi-Party Computation',
    description:
      '多方安全计算让多个参与方在不公开各自输入的前提下共同完成计算。每个参与方只看到自己的输入和最终允许披露的输出，中间值通常以秘密分享、混淆电路或同态加密形式存在。',
    bullets: [
      '适合隐私统计、交集计算、风险评分、跨院指标汇总等结构化计算任务。',
      '安全性强，但通信轮次、协议选择和数据规模会显著影响性能。',
      '医疗场景中常与输出门控结合，避免小样本统计结果反推出个人信息。',
    ],
  },
  {
    id: 'tee',
    icon: Cpu,
    title: '可信执行环境',
    label: 'Trusted Execution Environment',
    description:
      'TEE 是 CPU 或硬件平台提供的隔离执行区域，代码和数据在受保护的 enclave 中处理，宿主操作系统也不能直接读取。远程证明用于让数据提供方确认运行的是预期代码。',
    bullets: [
      '适合需要运行复杂模型、医学影像分析、真实世界研究算法的场景。',
      '关键能力包括内存隔离、度量启动、远程证明和密钥封装。',
      '仍需防范侧信道、依赖供应链和输出泄露，不能替代数据治理策略。',
    ],
  },
  {
    id: 'chain',
    icon: Blocks,
    title: '联盟链',
    label: 'Consortium Blockchain',
    description:
      '联盟链由许可节点共同维护账本，适合医疗数据流通中的多方审计、合约状态、模型哈希、计算结果摘要和授权记录存证。它强调可追溯与不可篡改，而不是存放原始医疗数据。',
    bullets: [
      '链上记录合约、授权、任务、证明、结果摘要和审计事件。',
      '链下保存数据、模型和报告，链上只保存哈希与状态引用。',
      '智能合约可自动约束用途、期限、参与方和结算规则。',
    ],
  },
];

const standards = [
  {
    name: 'HL7 FHIR',
    scope: '临床资源交换',
    use: '用 Patient、Observation、Condition、Medication、Encounter 等资源统一跨系统接口。',
  },
  {
    name: 'DICOM',
    scope: '医学影像',
    use: '承载 CT、MRI、超声等影像及元数据，适合影像 AI 和多中心影像研究。',
  },
  {
    name: 'ICD-10/ICD-11',
    scope: '疾病诊断编码',
    use: '统一诊断分类，支持病例筛选、队列定义、医保和公共卫生统计。',
  },
  {
    name: 'LOINC',
    scope: '检验检查编码',
    use: '标准化实验室指标和测量项目，减少不同医院检验名称差异。',
  },
  {
    name: 'SNOMED CT',
    scope: '临床术语体系',
    use: '表达更细粒度的临床概念，支持语义检索、知识图谱和临床决策支持。',
  },
  {
    name: 'OMOP CDM',
    scope: '真实世界研究模型',
    use: '把多源医疗数据映射到统一研究数据模型，便于队列研究和药物安全分析。',
  },
];

const frameworks = [
  {
    name: 'FATE',
    focus: '工业级联邦学习平台',
    strength: '横向、纵向、迁移学习能力完整，内置 PSI 与安全协议',
    fit: '金融、医疗多机构联合建模',
  },
  {
    name: 'Flower',
    focus: '轻量联邦学习框架',
    strength: '易接入 PyTorch、TensorFlow、JAX，适合快速实验和边缘设备',
    fit: '科研原型、移动端、跨框架训练',
  },
  {
    name: 'FedML',
    focus: '端云协同联邦学习',
    strength: '覆盖训练、部署、调度和实验管理',
    fit: 'IoT、移动端、云边端协同',
  },
  {
    name: 'TensorFlow Federated',
    focus: '联邦算法研究',
    strength: '与 TensorFlow 生态结合紧密，适合模拟和算法验证',
    fit: '学术研究、算法原型',
  },
  {
    name: 'PySyft',
    focus: '隐私计算与数据治理',
    strength: '强调远程数据访问控制、隐私预算和数据科学工作流',
    fit: '隐私保护数据科学、数据访问审批',
  },
];

const architectureLayers = [
  {
    icon: Hospital,
    title: '数据提供方',
    description: '医院、科研机构、药企或区域平台保留原始病历、影像、检验和随访数据。',
  },
  {
    icon: Server,
    title: '本地连接器',
    description: '完成脱敏、策略执行、TEE/MPC/FL 任务运行和输出门控，确保数据不出域。',
  },
  {
    icon: Shield,
    title: '控制平面',
    description: '管理参与方身份、数据产品目录、数字合约、任务编排和权限审核。',
  },
  {
    icon: Blocks,
    title: '链上审计',
    description: '保存合约哈希、授权记录、证明摘要、任务状态和结算凭证。',
  },
  {
    icon: Activity,
    title: '数据使用方',
    description: '获得聚合结果、模型参数、研究报告或合规证明，而非原始患者级数据。',
  },
];

const workloadTypes = [
  {
    type: 'legacy',
    label: '既有计算任务',
    method: 'mpc / fl / tee / sandbox',
    description: '兼容历史 ComputeTask 与已有演示，不改变原有 method 语义。',
  },
  {
    type: 'rws',
    label: '真实世界研究',
    method: 'tee',
    description: '面向结构化 FHIR/RWS 数据，走本地 connector、PEP、TEE 和输出闸门。',
  },
  {
    type: 'federated_learning',
    label: '联邦学习训练',
    method: 'fl',
    description: '承接 Flower/FATE 等横向或纵向联邦学习任务，输出模型更新或指标。',
  },
  {
    type: 'secretflow',
    label: '多模态密态训练',
    method: 'mpc / tee',
    description:
      'MVP 已接入：API 校验 secretflowSpec，connector 经 mock 适配器产出安全聚合结果；原始 DICOM/VCF/文本不离开本地。',
  },
];

const secretflowMvpStages = [
  {
    stage: '当前 MVP',
    status: '已实现',
    detail: '共享任务规格、API 校验、connector 路由、mock 适配器与安全输出闸门。',
  },
  {
    stage: 'CLI / Python 适配器',
    status: '规划中',
    detail: '对接 SecretFlow 官方运行时，替换 mock 适配器，保留相同输出契约。',
  },
  {
    stage: 'TEEU / HEU 适配器',
    status: '规划中',
    detail: '在 TEE 或同态加密单元中执行多模态 LoRA 微调，产出 attestation 与加密 delta 引用。',
  },
];

const secretflowSafeOutputs = [
  'lora_delta_hash — LoRA 权重更新的哈希摘要',
  'encrypted_delta_ref — 加密模型增量的外部引用',
  'aggregate_metrics — 聚合训练指标（loss、accuracy 等）',
  'attestation_report — TEE/MPC 执行证明',
  'model_card — 模型卡片元数据（不含原始样本）',
];

function ArchitectureDiagram() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-xl sm:p-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-center">
        <div className="space-y-3">
          <DiagramBox title="医院 A" subtitle="EHR / LIS / PACS" tone="blue" />
          <DiagramBox title="医院 B" subtitle="FHIR / DICOM / OMOP" tone="blue" />
          <DiagramBox title="科研机构" subtitle="队列与研究数据" tone="blue" />
        </div>

        <ArrowLabel label="本地接入" />

        <div className="space-y-3">
          <DiagramBox title="Connector" subtitle="脱敏 / 策略执行 / 输出门控" tone="emerald" />
          <DiagramBox title="隐私计算引擎" subtitle="FATE / MPC / TEE / Flower" tone="emerald" />
          <DiagramBox title="本地域数据仓" subtitle="原始数据不离开机构边界" tone="emerald" />
        </div>

        <ArrowLabel label="任务编排" />

        <div className="space-y-3">
          <DiagramBox title="MedTrust 控制平面" subtitle="身份 / 目录 / 合约 / 任务" tone="purple" />
          <DiagramBox title="联盟链审计" subtitle="哈希存证 / 状态追踪 / 结算" tone="purple" />
          <DiagramBox title="数据使用方" subtitle="聚合结果 / 模型 / 报告" tone="purple" />
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-slate-50 p-4">
        <div className="flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-2">
            <Database className="h-4 w-4 text-blue-600" />
            原始医疗数据留在本地
          </span>
          <span className="inline-flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-emerald-600" />
            只流通模型更新、密文份额或聚合结果
          </span>
          <span className="inline-flex items-center gap-2">
            <FileText className="h-4 w-4 text-purple-600" />
            授权与审计摘要上链
          </span>
        </div>
      </div>
    </div>
  );
}

function ArrowLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center text-sm font-semibold text-slate-500 lg:flex-col">
      <span className="hidden h-12 w-px bg-slate-200 lg:block" />
      <span className="rounded-full bg-slate-100 px-3 py-1">{label}</span>
      <span className="hidden h-12 w-px bg-slate-200 lg:block" />
      <span className="mx-2 h-px flex-1 bg-slate-200 lg:hidden" />
    </div>
  );
}

function DiagramBox({
  title,
  subtitle,
  tone,
}: {
  title: string;
  subtitle: string;
  tone: 'blue' | 'emerald' | 'purple';
}) {
  const tones = {
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    purple: 'border-purple-100 bg-purple-50 text-purple-700',
  };

  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="font-semibold">{title}</div>
      <div className="mt-1 text-sm text-slate-600">{subtitle}</div>
    </div>
  );
}

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-blue-50">
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-purple-600">
              <Shield className="h-5 w-5 text-white" />
            </span>
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-xl font-bold text-transparent">
              MedTrust Docs
            </span>
          </Link>
          <div className="hidden items-center gap-6 md:flex">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className="text-sm text-slate-600 hover:text-slate-900">
                {item.label}
              </a>
            ))}
          </div>
          <Link
            href="/dashboard"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            进入演示
          </Link>
        </div>
      </nav>

      <section className="px-4 pb-16 pt-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-4xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700">
              <Network className="h-4 w-4" />
              医疗可信数据空间知识文档
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              从隐私计算到联邦协作的
              <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                医疗数据基础设施
              </span>
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              本文档解释 MedTrust 涉及的核心技术：联邦学习 FATE、多方安全计算、可信执行环境、
              联盟链、医疗数据标准和常见联邦学习框架。整体目标是在医疗数据不离开机构边界的前提下，
              支持多中心科研、模型训练、审计监管和可信结算。
            </p>
          </div>
        </div>
      </section>

      <section id="architecture" className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex items-start gap-4">
            <div className="rounded-2xl bg-blue-600 p-3 text-white">
              <Layers3 className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-3xl font-bold text-slate-950">系统架构图</h2>
              <p className="mt-2 max-w-3xl text-slate-600">
                MedTrust 采用联邦可信数据空间架构：数据提供方部署本地连接器，控制平面只负责身份、目录、
              合约和任务编排。统一任务记录通过 workloadType 描述“做什么”，通过 method 描述“怎么执行”，使结构化 RWS
              与多模态 SecretFlow 任务共用治理层、分走不同运行时。
              </p>
            </div>
          </div>

          <ArchitectureDiagram />

          <div className="mt-8 grid gap-4 md:grid-cols-5">
            {architectureLayers.map((layer) => (
              <div key={layer.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <layer.icon className="mb-4 h-7 w-7 text-blue-600" />
                <h3 className="font-semibold text-slate-950">{layer.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{layer.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-start gap-3">
              <GitBranch className="mt-1 h-6 w-6 text-blue-600" />
              <div>
                <h3 className="text-xl font-bold text-slate-950">通用任务模型</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  workloadType 是平台级工作负载类型，method 是执行通道。二者分离后，控制面可以统一管理身份、
                  目录、合约、审计和结算，数据面按 workloadType 分发到 RWS、联邦学习或 SecretFlow 运行时。
                </p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {workloadTypes.map((workload) => (
                <div key={workload.type} className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-sm font-mono text-blue-600">{workload.type}</div>
                  <div className="mt-2 font-semibold text-slate-950">{workload.label}</div>
                  <div className="mt-1 text-xs text-slate-500">method: {workload.method}</div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{workload.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div id="secretflow" className="mt-8 rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-6 shadow-sm">
            <div className="mb-5 flex items-start gap-3">
              <Cpu className="mt-1 h-6 w-6 text-violet-600" />
              <div>
                <h3 className="text-xl font-bold text-slate-950">SecretFlow 工作负载（MVP）</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  SecretFlow 面向多模态密态训练：DICOM 影像、基因组 VCF、临床文本与结构化 EHR 可在各参与方本地保留，
                  控制面只编排任务与合约，connector 按 workloadType 路由到 SecretFlow 运行时。创建任务时设置{' '}
                  <code className="rounded bg-white px-1.5 py-0.5 text-xs text-violet-700">workloadType: secretflow</code>
                  ，并在 algorithmParams 中提交 secretflowSpec；method 必须为{' '}
                  <code className="rounded bg-white px-1.5 py-0.5 text-xs text-violet-700">tee</code> 或{' '}
                  <code className="rounded bg-white px-1.5 py-0.5 text-xs text-violet-700">mpc</code>，表示密态执行通道。
                </p>
              </div>
            </div>

            <div className="mb-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h4 className="font-semibold text-slate-950">与 RWS / 联邦学习的区别</h4>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                    RWS：结构化 FHIR 队列统计，单 method=tee，输出聚合统计。
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                    联邦学习：Flower/FATE 模型更新，method=fl。
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-violet-600" />
                    SecretFlow：多模态 + LoRA 微调规格，method=tee|mpc，输出受 outputPolicy 约束的安全制品。
                  </li>
                </ul>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h4 className="font-semibold text-slate-950">MVP 限制</h4>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  <li className="flex gap-2">
                    <Server className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
                    当前使用 mock 适配器，不调用真实 SecretFlow 集群。
                  </li>
                  <li className="flex gap-2">
                    <Lock className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
                    输出闸门会拒绝含 patientId、rawPayload 等敏感键的结果信封。
                  </li>
                  <li className="flex gap-2">
                    <Hospital className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
                    前端暂无 SecretFlow 任务创建表单；通过 API 提交 secretflowSpec。
                  </li>
                </ul>
              </div>
            </div>

            <h4 className="mb-3 font-semibold text-slate-950">允许的安全输出（outputPolicy.allowedArtifacts）</h4>
            <ul className="mb-6 grid gap-2 sm:grid-cols-2">
              {secretflowSafeOutputs.map((item) => (
                <li key={item} className="rounded-xl bg-white px-4 py-2 text-sm text-slate-600">
                  {item}
                </li>
              ))}
            </ul>

            <h4 className="mb-3 font-semibold text-slate-950">演进路线</h4>
            <div className="grid gap-3 md:grid-cols-3">
              {secretflowMvpStages.map((item) => (
                <div key={item.stage} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-950">{item.stage}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.status === '已实现'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="privacy-computing" className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-slate-950">关键技术说明</h2>
            <p className="mt-2 max-w-3xl text-slate-600">
              这些技术并非相互替代，而是按数据类型、计算复杂度、性能要求和监管约束组合使用。
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {knowledgeCards.map((card) => (
              <article
                key={card.id}
                id={card.id}
                className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-lg"
              >
                <div className="mb-5 flex items-center gap-4">
                  <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 p-3 text-white">
                    <card.icon className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-950">{card.title}</h3>
                    <p className="text-sm font-medium text-blue-600">{card.label}</p>
                  </div>
                </div>
                <p className="leading-7 text-slate-600">{card.description}</p>
                <ul className="mt-5 space-y-3">
                  {card.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3 text-sm leading-6 text-slate-600">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-emerald-600" />
                      {bullet}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="standards" className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-slate-950">医疗数据标准</h2>
            <p className="mt-2 max-w-3xl text-slate-600">
              医疗数据协作的前提是语义一致。标准化能降低跨院字段差异、编码差异和系统接口差异，
              让隐私计算任务有稳定的数据输入。
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {standards.map((standard) => (
              <div key={standard.name} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-lg font-bold text-slate-950">{standard.name}</h3>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500">
                    {standard.scope}
                  </span>
                </div>
                <p className="text-sm leading-6 text-slate-600">{standard.use}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="frameworks" className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-slate-950">联邦学习框架对比</h2>
            <p className="mt-2 max-w-3xl text-slate-600">
              框架选择取决于项目阶段。生产级跨机构协作通常关注安全协议、调度、审计和运维；
              算法研究则更关注模型接口、实验速度和可扩展性。
            </p>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-4 bg-slate-900 px-5 py-4 text-sm font-semibold text-white">
              <div>框架</div>
              <div>定位</div>
              <div>优势</div>
              <div>适用场景</div>
            </div>
            {frameworks.map((framework) => (
              <div
                key={framework.name}
                className="grid grid-cols-1 gap-3 border-t border-slate-100 px-5 py-5 text-sm md:grid-cols-4"
              >
                <div className="font-bold text-slate-950">{framework.name}</div>
                <div className="text-slate-600">{framework.focus}</div>
                <div className="text-slate-600">{framework.strength}</div>
                <div className="text-slate-600">{framework.fit}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl bg-gradient-to-br from-blue-600 to-purple-700 p-8 text-white shadow-xl sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-center">
            <div>
              <h2 className="text-3xl font-bold">建设医疗可信数据空间的核心原则</h2>
              <p className="mt-4 leading-8 text-blue-50">
                先做身份可信、授权可信、执行可信和结果可信，再谈数据流通规模。联邦学习、MPC、TEE 与联盟链
                共同解决的是不同层面的信任问题：谁能参与、能算什么、在哪里算、结果如何证明、责任如何追踪。
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 p-5 backdrop-blur">
              <ul className="space-y-3 text-sm text-blue-50">
                <li className="flex gap-3">
                  <CheckCircle2 className="h-5 w-5 flex-none text-white" />
                  数据最小化：只取任务需要的字段和样本范围。
                </li>
                <li className="flex gap-3">
                  <CheckCircle2 className="h-5 w-5 flex-none text-white" />
                  计算本地化：原始数据在连接器和本地域内处理。
                </li>
                <li className="flex gap-3">
                  <CheckCircle2 className="h-5 w-5 flex-none text-white" />
                  输出可控：小样本、明细行和敏感结果必须被阻断。
                </li>
                <li className="flex gap-3">
                  <CheckCircle2 className="h-5 w-5 flex-none text-white" />
                  全程留痕：合约、证明、结果摘要和结算凭证可审计。
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
