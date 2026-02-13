'use client';

import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* 导航栏 */}
      <nav className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold">M</span>
              </div>
              <span className="text-xl font-bold text-slate-900">MedTrust</span>
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
      <section className="pt-20 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 mb-6">
            医疗数据可信空间
          </h1>
          <p className="text-xl text-slate-600 mb-8">
            基于联邦学习、多方安全计算、可信执行环境等隐私计算技术，
            实现医疗数据"可用不可见"的可信流通
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link 
              href="/dashboard"
              className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              开始演示
            </Link>
            <a 
              href="https://github.com/medtrust/demo"
              className="inline-flex items-center px-6 py-3 bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition"
            >
              查看文档
            </a>
          </div>
        </div>
      </section>

      {/* 核心功能 */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-12">核心能力</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-slate-50 rounded-xl p-6">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                <span className="text-2xl">🛡️</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">数据可用不可见</h3>
              <p className="text-slate-600 text-sm">
                通过联邦学习、多方安全计算等技术，原始数据始终保留在本地，仅共享计算结果
              </p>
            </div>
            <div className="bg-slate-50 rounded-xl p-6">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                <span className="text-2xl">📋</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">全流程可追溯</h3>
              <p className="text-slate-600 text-sm">
                基于FISCO BCOS联盟链，数据申请、审批、计算全流程上链存证
              </p>
            </div>
            <div className="bg-slate-50 rounded-xl p-6">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                <span className="text-2xl">🔐</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">合规自动化</h3>
              <p className="text-slate-600 text-sm">
                智能合约自动执行使用条款，国密算法保障数据安全
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 演示场景 */}
      <section className="py-16 bg-slate-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-12">演示场景</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <span className="text-2xl">🤝</span>
                <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">已完成</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">联邦学习联合建模</h3>
              <p className="text-slate-600 text-sm mb-4">
                华山医院与瑞金医院联合训练心血管疾病预测模型，数据不出院
              </p>
              <div className="text-sm text-slate-500">
                技术: Flower + FATE | 准确率: 87.6%
              </div>
            </div>
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <span className="text-2xl">📊</span>
                <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">已完成</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">多方安全计算统计</h3>
              <p className="text-slate-600 text-sm mb-4">
                卫健委统计区域疾病发病率，不获取单院原始数据
              </p>
              <div className="text-sm text-slate-500">
                技术: MP-SPDZ | 协议: Shamir
              </div>
            </div>
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <span className="text-2xl">🧬</span>
                <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">进行中</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">可信执行环境分析</h3>
              <p className="text-slate-600 text-sm mb-4">
                在SGX硬件保护下进行基因突变与药物反应关联分析
              </p>
              <div className="text-sm text-slate-500">
                技术: Intel SGX | 进度: 65%
              </div>
            </div>
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <span className="text-2xl">🔍</span>
                <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">已完成</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">安全沙箱数据分析</h3>
              <p className="text-slate-600 text-sm mb-4">
                在隔离环境中进行糖尿病用药疗效对比分析
              </p>
              <div className="text-sm text-slate-500">
                技术: Secure Sandbox | 结果: 已脱敏
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 合作机构 */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-12">演示合作机构</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { name: '华山医院', type: '三级甲等' },
              { name: '瑞金医院', type: '三级甲等' },
              { name: '医科大数据研究院', type: '科研机构' },
              { name: '智慧医疗AI', type: '科技企业' },
              { name: '区域卫健委', type: '监管部门' },
            ].map((org) => (
              <div key={org.name} className="bg-slate-50 rounded-lg p-4 text-center">
                <div className="w-12 h-12 bg-blue-600 rounded-full mx-auto mb-2 flex items-center justify-center text-white font-bold">
                  {org.name[0]}
                </div>
                <div className="font-medium text-sm text-slate-900">{org.name}</div>
                <div className="text-xs text-slate-500">{org.type}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-blue-600">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-4">
            开始探索医疗数据可信空间
          </h2>
          <p className="text-blue-100 mb-8">
            体验隐私计算技术如何改变医疗数据协作方式
          </p>
          <Link 
            href="/dashboard"
            className="inline-flex items-center px-6 py-3 bg-white text-blue-600 rounded-lg hover:bg-blue-50 transition font-medium"
          >
            进入演示系统
          </Link>
        </div>
      </section>

      {/* 页脚 */}
      <footer className="bg-slate-900 text-slate-400 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-sm">© 2026 MedTrust Demo. 演示用途，数据均为模拟生成。</p>
        </div>
      </footer>
    </div>
  );
}
