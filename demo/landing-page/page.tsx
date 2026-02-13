'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Shield, 
  Database, 
  Lock, 
  Activity, 
  Users, 
  FileCheck, 
  ArrowRight,
  Play,
  CheckCircle,
  Building,
  Microscope,
  Server,
  ChevronRight,
  BarChart3,
  Network,
  Cpu,
  Eye
} from 'lucide-react';

// 统计数据
const stats = [
  { label: '合作医疗机构', value: 5, suffix: '家', icon: Building },
  { label: '数据资产', value: 8, suffix: '个', icon: Database },
  { label: '隐私计算任务', value: 12, suffix: '+', icon: Cpu },
  { label: '数据记录', value: 10, suffix: '万+', icon: FileCheck },
];

// 合作机构
const partners = [
  { name: '华山医院', type: '三级甲等', specialty: '心血管/神经', color: 'bg-blue-600' },
  { name: '瑞金医院', type: '三级甲等', specialty: '血液/内分泌', color: 'bg-green-600' },
  { name: '医科大数据研究院', type: '科研机构', specialty: '疾病预测模型', color: 'bg-purple-600' },
  { name: '智慧医疗AI', type: '科技企业', specialty: '医学影像AI', color: 'bg-orange-600' },
  { name: '区域卫健委', type: '监管部门', specialty: '数据治理', color: 'bg-red-600' },
];

// 核心功能
const features = [
  {
    icon: Shield,
    title: '数据可用不可见',
    description: '通过联邦学习、多方安全计算等隐私计算技术，原始数据始终保留在本地，仅共享计算结果',
    color: 'from-blue-500 to-cyan-500',
  },
  {
    icon: FileCheck,
    title: '全流程可追溯',
    description: '基于FISCO BCOS联盟链，数据申请、审批、计算、交付全流程上链存证，确保合规审计',
    color: 'from-green-500 to-emerald-500',
  },
  {
    icon: Lock,
    title: '合规自动化',
    description: '智能合约自动执行使用条款，国密算法保障数据安全，符合《数据安全法》《个人信息保护法》',
    color: 'from-purple-500 to-violet-500',
  },
];

// 演示场景
const scenarios = [
  {
    id: 'fl',
    title: '联邦学习联合建模',
    description: '多医院联合训练疾病预测模型，数据不出院',
    tech: 'Flower + FATE',
    status: 'completed',
    participants: ['华山医院', '瑞金医院', '研究院'],
    result: '准确率 87.6%',
    icon: Network,
    color: 'blue',
  },
  {
    id: 'mpc',
    title: '多方安全计算统计',
    description: '隐私求和与均值计算，不泄露单院原始数据',
    tech: 'MP-SPDZ',
    status: 'completed',
    participants: ['华山医院', '瑞金医院', '卫健委'],
    result: '统计完成',
    icon: BarChart3,
    color: 'green',
  },
  {
    id: 'tee',
    title: '可信执行环境分析',
    description: 'SGX硬件级安全保护下的基因数据分析',
    tech: 'Intel SGX',
    status: 'running',
    participants: ['瑞金医院', 'AI医疗科技'],
    result: '进行中 65%',
    icon: Cpu,
    color: 'purple',
  },
  {
    id: 'sandbox',
    title: '安全沙箱数据分析',
    description: '在隔离环境中进行药物疗效对比分析',
    tech: 'Secure Sandbox',
    status: 'completed',
    participants: ['华山医院', '研究院'],
    result: '分析完成',
    icon: Eye,
    color: 'orange',
  },
];

// 技术栈
const techStack = [
  { name: 'NestJS', category: '后端框架' },
  { name: 'FATE', category: '联邦学习' },
  { name: 'MP-SPDZ', category: '多方安全计算' },
  { name: 'Intel SGX', category: '可信执行环境' },
  { name: 'FISCO BCOS', category: '联盟链' },
  { name: 'FHIR R4', category: '医疗标准' },
  { name: '国密 SM2/3/4', category: '数据加密' },
  { name: 'Flower', category: '联邦学习框架' },
];

export default function LandingPage() {
  const [animatedStats, setAnimatedStats] = useState(stats.map(() => 0));
  const [activeScenario, setActiveScenario] = useState<string | null>(null);

  // 数字动画效果
  useEffect(() => {
    const duration = 2000;
    const steps = 60;
    const interval = duration / steps;
    let step = 0;

    const timer = setInterval(() => {
      step++;
      const progress = step / steps;
      const easeOut = 1 - Math.pow(1 - progress, 3);
      
      setAnimatedStats(stats.map(s => Math.floor(s.value * easeOut)));

      if (step >= steps) {
        clearInterval(timer);
        setAnimatedStats(stats.map(s => s.value));
      }
    }, interval);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* 导航栏 */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                MedTrust
              </span>
            </div>
            <div className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-slate-600 hover:text-slate-900">核心能力</a>
              <a href="#scenarios" className="text-slate-600 hover:text-slate-900">演示场景</a>
              <a href="#partners" className="text-slate-600 hover:text-slate-900">合作机构</a>
              <a href="#tech" className="text-slate-600 hover:text-slate-900">技术架构</a>
            </div>
            <div className="flex items-center space-x-4">
              <Link 
                href="/login" 
                className="text-slate-600 hover:text-slate-900"
              >
                登录
              </Link>
              <Link 
                href="/dashboard" 
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
              >
                进入演示
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <div className="inline-flex items-center px-4 py-2 rounded-full bg-blue-50 text-blue-700 text-sm font-medium mb-8">
            <span className="w-2 h-2 bg-blue-600 rounded-full mr-2 animate-pulse"></span>
            医疗数据可信流通平台演示
          </div>
          
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 mb-6">
            让医疗数据
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              安全流通
            </span>
          </h1>
          
          <p className="text-xl text-slate-600 max-w-3xl mx-auto mb-10">
            基于联邦学习、多方安全计算、可信执行环境等隐私计算技术，
            实现医疗数据"可用不可见"的可信流通，助力多中心科研协作与AI模型训练
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link 
              href="/dashboard"
              className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-lg font-medium"
            >
              <Play className="w-5 h-5 mr-2" />
              开始演示
            </Link>
            <a 
              href="#scenarios"
              className="inline-flex items-center px-6 py-3 bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition text-lg font-medium"
            >
              查看场景
              <ArrowRight className="w-5 h-5 ml-2" />
            </a>
          </div>

          {/* 实时数据看板 */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {stats.map((stat, index) => (
              <div 
                key={stat.label}
                className="bg-white rounded-xl p-6 shadow-lg border border-slate-100"
              >
                <stat.icon className="w-8 h-8 text-blue-600 mx-auto mb-3" />
                <div className="text-3xl font-bold text-slate-900">
                  {animatedStats[index]}{stat.suffix}
                </div>
                <div className="text-sm text-slate-500 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 核心能力 */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">核心能力</h2>
            <p className="text-lg text-slate-600">三大技术支柱，构建医疗数据可信流通基础设施</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {features.map((feature) => (
              <div 
                key={feature.title}
                className="group relative bg-slate-50 rounded-2xl p-8 hover:shadow-xl transition"
              >
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-6 group-hover:scale-110 transition`}>
                  <feature.icon className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{feature.title}</h3>
                <p className="text-slate-600 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 演示场景 */}
      <section id="scenarios" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">演示场景</h2>
            <p className="text-lg text-slate-600">四种隐私计算场景，覆盖真实医疗数据协作需求</p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6">
            {scenarios.map((scenario) => (
              <div 
                key={scenario.id}
                className={`bg-white rounded-2xl p-6 shadow-sm border-2 border-transparent hover:border-${scenario.color}-200 transition cursor-pointer`}
                onClick={() => setActiveScenario(activeScenario === scenario.id ? null : scenario.id)}
              >
                <div className="flex items-start justify-between">
                  <div className={`w-12 h-12 rounded-xl bg-${scenario.color}-100 flex items-center justify-center`}>
                    <scenario.icon className={`w-6 h-6 text-${scenario.color}-600`} />
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    scenario.status === 'completed' 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-blue-100 text-blue-700'
                  }`}>
                    {scenario.status === 'completed' ? '已完成' : '进行中'}
                  </span>
                </div>
                
                <h3 className="text-lg font-bold text-slate-900 mt-4 mb-2">{scenario.title}</h3>
                <p className="text-slate-600 text-sm mb-4">{scenario.description}</p>
                
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">技术: {scenario.tech}</span>
                  <span className={`font-medium text-${scenario.color}-600`}>{scenario.result}</span>
                </div>
                
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Users className="w-4 h-4" />
                    <span>参与方: {scenario.participants.join('、')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          <div className="text-center mt-10">
            <Link 
              href="/dashboard"
              className="inline-flex items-center px-6 py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition"
            >
              查看全部计算任务
              <ChevronRight className="w-5 h-5 ml-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* 合作机构 */}
      <section id="partners" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">合作机构</h2>
            <p className="text-lg text-slate-600">模拟区域医疗数据联盟成员</p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
            {partners.map((partner) => (
              <div 
                key={partner.name}
                className="bg-slate-50 rounded-xl p-6 text-center hover:shadow-lg transition"
              >
                <div className={`w-16 h-16 ${partner.color} rounded-full mx-auto mb-4 flex items-center justify-center`}>
                  <Building className="w-8 h-8 text-white" />
                </div>
                <h4 className="font-bold text-slate-900 mb-1">{partner.name}</h4>
                <p className="text-xs text-slate-500 mb-2">{partner.type}</p>
                <p className="text-xs text-blue-600">{partner.specialty}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 技术架构 */}
      <section id="tech" className="py-20 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">技术架构</h2>
            <p className="text-lg text-slate-400">企业级隐私计算技术栈</p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {techStack.map((tech) => (
              <div 
                key={tech.name}
                className="bg-slate-800 rounded-lg p-4 text-center hover:bg-slate-700 transition"
              >
                <div className="font-semibold text-white mb-1">{tech.name}</div>
                <div className="text-xs text-slate-400">{tech.category}</div>
              </div>
            ))}
          </div>
          
          {/* 架构图示意 */}
          <div className="mt-16 bg-slate-800 rounded-2xl p-8">
            <h3 className="text-xl font-bold text-center mb-8">系统架构示意</h3>
            <div className="flex flex-col md:flex-row items-center justify-center gap-8">
              <div className="text-center">
                <div className="w-24 h-24 bg-blue-600 rounded-xl flex items-center justify-center mb-3">
                  <Building className="w-10 h-10" />
                </div>
                <p className="text-sm">数据提供方</p>
                <p className="text-xs text-slate-400">医院/科室</p>
              </div>
              
              <ArrowRight className="w-8 h-8 text-slate-500 hidden md:block" />
              
              <div className="text-center">
                <div className="w-32 h-32 bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl flex flex-col items-center justify-center mb-3">
                  <Server className="w-8 h-8 mb-2" />
                  <p className="text-xs">MedTrust</p>
                  <p className="text-xs">平台</p>
                </div>
                <p className="text-sm">可信协调层</p>
                <p className="text-xs text-slate-400">隐私计算调度</p>
              </div>
              
              <ArrowRight className="w-8 h-8 text-slate-500 hidden md:block" />
              
              <div className="text-center">
                <div className="w-24 h-24 bg-green-600 rounded-xl flex items-center justify-center mb-3">
                  <Microscope className="w-10 h-10" />
                </div>
                <p className="text-sm">数据消费方</p>
                <p className="text-xs text-slate-400">科研机构/企业</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-gradient-to-br from-blue-600 to-purple-600">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-6">
            开始探索医疗数据可信空间
          </h2>
          <p className="text-xl text-blue-100 mb-10">
            体验隐私计算技术如何改变医疗数据协作方式
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link 
              href="/dashboard"
              className="inline-flex items-center px-8 py-4 bg-white text-blue-600 rounded-lg hover:bg-blue-50 transition text-lg font-bold"
            >
              进入演示系统
              <ArrowRight className="w-5 h-5 ml-2" />
            </Link>
            <a 
              href="https://github.com/medtrust/demo"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-8 py-4 bg-transparent text-white border-2 border-white rounded-lg hover:bg-white/10 transition text-lg"
            >
              查看技术文档
            </a>
          </div>
        </div>
      </section>

      {/* 页脚 */}
      <footer className="bg-slate-900 text-slate-400 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <Shield className="w-6 h-6 text-blue-500" />
                <span className="text-lg font-bold text-white">MedTrust</span>
              </div>
              <p className="text-sm">医疗数据可信空间演示平台</p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">演示场景</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/dashboard" className="hover:text-white">联邦学习</Link></li>
                <li><Link href="/dashboard" className="hover:text-white">多方安全计算</Link></li>
                <li><Link href="/dashboard" className="hover:text-white">可信执行环境</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">技术文档</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-white">架构设计</a></li>
                <li><a href="#" className="hover:text-white">API文档</a></li>
                <li><a href="#" className="hover:text-white">部署指南</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">联系我们</h4>
              <p className="text-sm">demo@medtrust.space</p>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 text-sm text-center">
            <p>© 2026 MedTrust Demo. 演示用途，数据均为模拟生成。</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
