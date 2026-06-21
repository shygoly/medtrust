'use client';

import Link from 'next/link';
import {
  Shield,
  ArrowRight,
  Play,
  Lock,
  Database,
  FileCheck,
  Network,
  Cpu,
  Building2,
  Microscope,
  Server,
  Scale,
  FileText,
  Globe,
  ChevronRight,
  Layers,
  Workflow,
  Fingerprint,
  Coins,
} from 'lucide-react';
import { ClosureLoop } from '@/components/landing/closure-loop';
import { OrchestrationPipeline } from '@/components/landing/orchestration-pipeline';
import { DataResidencyDiagram } from '@/components/landing/data-residency-diagram';
import { LossSparkline } from '@/components/landing/loss-sparkline';

const NAV_LINKS = [
  { href: '#closures', label: '三闭环' },
  { href: '#residency', label: '数据不出域' },
  { href: '#secretflow', label: '密算编排' },
  { href: '#compliance', label: '合规' },
  { href: '/docs', label: '文档' },
];

const CLOSURE_DETAILS = [
  {
    id: 'orchestration',
    title: '编排闭环',
    icon: Workflow,
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    border: 'border-blue-200',
    chain: ['声明式 YAML 任务', '异构适配 + 转译', 'gRPC 下发跨域训练', 'loss / 状态实时回传', 'FSM 补偿 → 结果回流'],
  },
  {
    id: 'data',
    title: '数据闭环',
    icon: Database,
    iconBg: 'bg-teal-100',
    iconColor: 'text-teal-600',
    border: 'border-teal-200',
    chain: ['本地去标识', '数据不出域守卫', 'in-TEE 计算', '输出门 (小单元格抑制)', '阅后即焚'],
  },
  {
    id: 'commercial',
    title: '商业闭环',
    icon: Coins,
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-600',
    border: 'border-violet-200',
    chain: ['数据产品挂牌 (URN)', '合约准入 (fail-closed)', '按贡献计量', '链上存证', '按角色分账台账'],
  },
];

const CONNECTOR_FEATURES = [
  { label: 'local-store 守卫', desc: '原始行级数据禁止离域' },
  { label: 'in-TEE 计算', desc: '可信执行环境内完成运算' },
  { label: '输出门', desc: '小单元格抑制 + 行级阻断' },
  { label: 'PEP 合约执行', desc: '策略执行点 fail-closed' },
  { label: '阅后即焚', desc: '任务结束自动销毁中间产物' },
];

const TRUST_PILLARS = [
  {
    icon: Fingerprint,
    title: 'SM2 CA 双认证',
    desc: '参与方身份 CA、安全通道 SM2+SM3 签名，双认证准入与分类分级门禁。',
  },
  {
    icon: FileText,
    title: '数字合约 + PEP',
    desc: '合约生成与哈希存证，连接器 PEP 在本地强制执行使用控制。',
  },
  {
    icon: Layers,
    title: 'Catalog 数据产品',
    desc: 'URN 挂牌仅暴露元数据目录，不汇聚各院原始数据。',
  },
  {
    icon: Globe,
    title: '跨空间联邦',
    desc: '跨可信数据空间的信任清单与协作准入，支持多空间互联。',
  },
];

const ROLES = [
  {
    icon: Building2,
    title: '数据提供方',
    subtitle: '医院 / 科室',
    desc: '本地持有去标识数据，经连接器守卫与输出门放行聚合结果。',
    color: 'bg-blue-100 text-blue-700',
  },
  {
    icon: Microscope,
    title: '数据需求方',
    subtitle: '科研 / 药企',
    desc: '通过数字合约申请数据产品，获取经输出门过滤的聚合产物。',
    color: 'bg-teal-100 text-teal-700',
  },
  {
    icon: Scale,
    title: '运营方',
    subtitle: '监管 / 平台',
    desc: '治理目录、审计全程、协调跨院任务与合规监督。',
    color: 'bg-amber-100 text-amber-700',
  },
  {
    icon: Server,
    title: '技术提供方',
    subtitle: '隐私计算厂商',
    desc: '提供 TEE、密算运行时与编排适配，对接 FATE / MP-SPDZ 等引擎。',
    color: 'bg-violet-100 text-violet-700',
  },
];

const TECH_STACK = [
  { name: 'NestJS / Next.js', category: '控制面 & 前端', built: true },
  { name: '密算编排器', category: '声明式转译 · FSM', built: true },
  { name: 'PyTorch + LoRA', category: '联邦微调运行时', built: true },
  { name: 'FHIR R4', category: '医疗数据标准', built: true },
  { name: '国密 SM2/3/4', category: '加密与签名', built: true },
  { name: 'SecretFlow / Ray', category: '机密计算运行时', built: false },
  { name: 'FATE / Flower', category: '联邦学习', built: false },
  { name: 'MP-SPDZ', category: '多方安全计算', built: false },
  { name: 'Intel SGX / TEE', category: '可信执行', built: false },
  { name: 'FISCO BCOS', category: '链上存证', built: false },
];

const MODALITIES = ['DICOM 影像', '基因序列', '临床文本', '结构化 EHR'];
const ARTIFACTS = ['lora_delta_hash', 'aggregate_metrics', 'attestation_report'];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/85 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-teal-600 rounded-lg flex items-center justify-center shadow-sm">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-slate-900 tracking-tight">MedTrust</span>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-medium">
                原型演示
              </span>
            </div>

            <div className="hidden lg:flex items-center gap-6">
              {NAV_LINKS.map((link) =>
                link.href.startsWith('#') ? (
                  <a key={link.href} href={link.href} className="text-sm text-slate-600 hover:text-slate-900 transition">
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.href} href={link.href} className="text-sm text-slate-600 hover:text-slate-900 transition">
                    {link.label}
                  </Link>
                ),
              )}
            </div>

            <div className="flex items-center gap-3">
              <Link href="/login" className="text-sm text-slate-600 hover:text-slate-900 transition">
                登录
              </Link>
              <Link
                href="/login"
                className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition shadow-sm"
              >
                进入演示
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-28 pb-16 md:pt-32 md:pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium mb-6 border border-blue-100">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-2 motion-safe:animate-pulse" />
                医疗可信数据空间 · 原型演示
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 leading-tight mb-5 tracking-tight">
                三闭环驱动的
                <span className="text-blue-600"> 联邦可信数据空间</span>
              </h1>

              <p className="text-lg text-slate-600 leading-relaxed mb-8 max-w-xl mx-auto lg:mx-0">
                数据不出域 · 声明式密算编排 · 按贡献分账——编排、数据与商业三条闭环在合规护栏内相互咬合，构成可审计、可辩护的医疗数据协作基础设施。
              </p>

              <div className="flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-3">
                <Link
                  href="/login"
                  className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium shadow-sm"
                >
                  <Play className="w-4 h-4 mr-2" />
                  进入演示
                </Link>
                <Link
                  href="/docs"
                  className="inline-flex items-center px-6 py-3 bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition font-medium"
                >
                  查看文档
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-50/80 to-teal-50/60 rounded-3xl blur-2xl" />
              <div className="relative bg-white/70 backdrop-blur-sm rounded-2xl border border-slate-200/80 p-6 shadow-lg">
                <ClosureLoop />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Three Closures Detail */}
      <section id="closures" className="py-20 bg-white border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">三闭环详解</h2>
            <p className="text-slate-600 max-w-2xl mx-auto">
              任务、数据、价值三条流各自循环，共同运行在<span className="text-amber-700 font-medium">合规护栏</span>内：事前资质分级 · 事中存证与授权校验 · 事后审计追溯与删除权。
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {CLOSURE_DETAILS.map((c) => (
              <div
                key={c.id}
                className={`rounded-2xl border ${c.border} bg-slate-50/50 p-6 hover:shadow-md transition`}
              >
                <div className={`w-11 h-11 rounded-xl ${c.iconBg} flex items-center justify-center mb-4`}>
                  <c.icon className={`w-5 h-5 ${c.iconColor}`} />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-4">{c.title}</h3>
                <ol className="space-y-2">
                  {c.chain.map((step, i) => (
                    <li key={step} className="flex items-start gap-2 text-sm text-slate-600">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[10px] font-medium text-slate-500">
                        {i + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Data Residency */}
      <section id="residency" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-teal-50 text-teal-700 text-xs font-medium mb-4 border border-teal-100">
                <Lock className="w-3 h-3" />
                已实现 · 有测试
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">数据不出域</h2>
              <p className="text-slate-600 leading-relaxed mb-6">
                连接器部署在各参与方本地侧。原始医疗数据始终保留在院内边界内，经 in-TEE 计算与输出门过滤后，仅聚合指标获准外流。
              </p>
              <ul className="space-y-3">
                {CONNECTOR_FEATURES.map((f) => (
                  <li key={f.label} className="flex items-start gap-3">
                    <FileCheck className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-sm font-medium text-slate-900">{f.label}</span>
                      <span className="text-sm text-slate-500"> — {f.desc}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <DataResidencyDiagram />
            </div>
          </div>
        </div>
      </section>

      {/* SecretFlow Orchestration */}
      <section id="secretflow" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-medium mb-4 border border-blue-100">
              <Workflow className="w-3 h-3" />
              旗舰能力
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">SecretFlow 声明式密算编排</h2>
            <p className="text-slate-600 max-w-3xl mx-auto">
              YAML 任务声明 → 异构节点适配 → 转译执行计划 → gRPC 下发 Agent → 多模态 LoRA FedAvg → WebSocket 实时 loss 流 → FSM 状态机与补偿。
            </p>
          </div>

          <div className="mb-10">
            <OrchestrationPipeline />
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-slate-50/50 p-6">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">多模态联邦微调</h3>
              <div className="flex flex-wrap gap-2 mb-4">
                {MODALITIES.map((m) => (
                  <span key={m} className="px-2.5 py-1 rounded-md bg-white border border-slate-200 text-xs text-slate-700">
                    {m}
                  </span>
                ))}
              </div>
              <p className="text-sm text-slate-600 mb-4">
                融合桥支持 linear_projection / perceiver_resampler；PEFT 策略默认 LoRA；安全产物仅输出经策略允许的工件。
              </p>
              <div className="flex flex-wrap gap-2">
                {ARTIFACTS.map((a) => (
                  <code key={a} className="px-2 py-0.5 rounded bg-slate-900 text-teal-300 text-[11px] font-mono">
                    {a}
                  </code>
                ))}
              </div>
            </div>

            <LossSparkline />
          </div>

          <div className="text-center mt-10">
            <Link
              href="/space/atlas/compose"
              className="inline-flex items-center px-6 py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition font-medium"
            >
              打开密算编排控制台
              <ChevronRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* Trust Foundation */}
      <section id="trust" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">信任根基</h2>
            <p className="text-slate-600">身份 · 合约 · 目录 · 联邦——控制面已落地并测试</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {TRUST_PILLARS.map((p) => (
              <div key={p.title} className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center mb-3">
                  <p.icon className="w-5 h-5 text-blue-600" />
                </div>
                <h3 className="font-semibold text-slate-900 mb-2">{p.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance */}
      <section id="compliance" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-blue-50/30 p-8 md:p-12">
            <div className="grid md:grid-cols-2 gap-8 items-center">
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">国密 / 等保合规</h2>
                <p className="text-slate-600 leading-relaxed mb-6">
                  全栈国密算法 SM2/SM3/SM4，HashiCorp Vault 密钥管理，列级加密与 API 响应脱敏，全程审计日志与链上存证。
                </p>
                <ul className="space-y-2 text-sm text-slate-700">
                  <li className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-600" />
                    SM2 签名 · SM3 摘要 · SM4 加密
                  </li>
                  <li className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-blue-600" />
                    @EncryptedColumn / @Masked 装饰器
                  </li>
                  <li className="flex items-center gap-2">
                    <FileCheck className="w-4 h-4 text-blue-600" />
                    符合《数据安全法》《个人信息保护法》
                  </li>
                </ul>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {['Vault 密钥缓存', 'SM2 CA 证书', '审计日志', '链上哈希存证'].map((item) => (
                  <div key={item} className="bg-white rounded-xl border border-slate-200 p-4 text-center">
                    <Cpu className="w-6 h-6 text-blue-600 mx-auto mb-2" />
                    <span className="text-sm font-medium text-slate-800">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Roles */}
      <section id="roles" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">参与方角色</h2>
            <p className="text-slate-600">四类租户各司其职，协作完成可信数据流通</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {ROLES.map((r) => (
              <div key={r.title} className="bg-white rounded-xl border border-slate-200 p-5">
                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium mb-3 ${r.color}`}>
                  {r.subtitle}
                </span>
                <div className="flex items-center gap-2 mb-2">
                  <r.icon className="w-5 h-5 text-slate-700" />
                  <h3 className="font-semibold text-slate-900">{r.title}</h3>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section id="tech" className="py-20 bg-white border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">技术栈与对接</h2>
            <p className="text-slate-600">核心控制面与编排已实现；外部运行时标注为对接/支持</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {TECH_STACK.map((t) => (
              <div
                key={t.name}
                className={`rounded-xl border p-4 text-center transition ${
                  t.built
                    ? 'bg-blue-50/50 border-blue-200'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="font-medium text-slate-900 text-sm mb-0.5">{t.name}</div>
                <div className="text-[11px] text-slate-500">{t.category}</div>
                <div className={`text-[10px] mt-1.5 font-medium ${t.built ? 'text-blue-600' : 'text-slate-400'}`}>
                  {t.built ? '已实现' : '对接/支持'}
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-slate-400 mt-6">
            本机以 PyTorch 回退运行（SecretFlow/Ray 为可选机密运行时）；FATE、MP-SPDZ、SGX、FISCO BCOS 等通过适配层对接，非本仓库内置部署。
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 bg-gradient-to-br from-blue-600 via-blue-700 to-teal-700">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">探索联邦可信数据空间</h2>
          <p className="text-blue-100 mb-8">原型演示：数据为模拟，但核心能力在代码中已实现、可对照验证。</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center px-7 py-3.5 bg-white text-blue-700 rounded-lg hover:bg-blue-50 transition font-semibold shadow-sm"
            >
              进入演示
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center px-7 py-3.5 text-white border-2 border-white/60 rounded-lg hover:bg-white/10 transition font-medium"
            >
              查看文档
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-5 h-5 text-blue-400" />
                <span className="text-lg font-bold text-white">MedTrust</span>
              </div>
              <p className="text-sm leading-relaxed">
                医疗可信数据空间原型演示。数据均为合成/模拟，不代表真实患者信息。
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-3 text-sm">快速入口</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="/space" className="hover:text-white transition">
                    控制台
                  </Link>
                </li>
                <li>
                  <Link href="/space/atlas/compose" className="hover:text-white transition">
                    密算编排
                  </Link>
                </li>
                <li>
                  <Link href="/docs" className="hover:text-white transition">
                    技术文档
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-3 text-sm">架构要点</h4>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <Network className="w-3.5 h-3.5" />
                  联邦数据空间（数据不出域）
                </li>
                <li className="flex items-center gap-2">
                  <Workflow className="w-3.5 h-3.5" />
                  SecretFlow 声明式编排
                </li>
                <li className="flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5" />
                  国密 SM2/3/4 全栈
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-6 text-xs text-center text-slate-500">
            © 2026 MedTrust · 原型演示，数据为合成/模拟
          </div>
        </div>
      </footer>
    </div>
  );
}
