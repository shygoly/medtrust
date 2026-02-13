#!/usr/bin/env node

/**
 * MedTrust 演示数据快速初始化脚本
 * 
 * 用法: node demo/seed-database.js
 */

const fs = require('fs');
const path = require('path');

console.log(`
╔════════════════════════════════════════════════════════════════╗
║              MedTrust 演示数据初始化工具                       ║
╚════════════════════════════════════════════════════════════════╝

本脚本将演示数据导入到 MedTrust 数据库中。

包含数据:
  • 5 个模拟租户 (医院/科研机构/企业/监管)
  • 6 个演示用户
  • 8 个数据资产
  • 6 个访问申请
  • 6 个计算任务

演示场景:
  1. 联邦学习 - 心血管疾病预测模型
  2. 多方安全计算 - 区域疾病发病率统计
  3. 可信执行环境 - 基因数据分析
  4. 安全沙箱 - 药物疗效对比
`);

// 检查数据库文件
const dbPath = path.join(__dirname, '..', 'data', 'medtrust.db');
console.log('📁 检查数据库...');
if (fs.existsSync(dbPath)) {
  console.log(`   ✓ 数据库存在: ${dbPath}`);
} else {
  console.log(`   ⚠ 数据库不存在，将在首次启动时自动创建`);
}

// 显示数据摘要
const tenants = require('./data/tenants.json');
const assets = require('./data/assets.json');
const tasks = require('./data/tasks.json');

console.log('\n📊 演示数据摘要:');
console.log('   ┌─────────────────────────────────────────┐');
console.log(`   │  租户数量:     ${String(tenants.tenants.length).padStart(4)}                    │`);
console.log(`   │  用户数量:     ${String(tenants.users.length).padStart(4)}                    │`);
console.log(`   │  数据资产:     ${String(assets.assets.length).padStart(4)}                    │`);
console.log(`   │  计算任务:     ${String(tasks.computeTasks.length).padStart(4)}                    │`);
console.log('   └─────────────────────────────────────────┘');

console.log('\n🏢 演示租户:');
tenants.tenants.forEach(t => {
  const typeMap = { provider: '数据提供', consumer: '数据消费', admin: '监管方' };
  console.log(`   • ${t.name} (${typeMap[t.type]})`);
});

console.log('\n📋 下一步操作:');
console.log('   1. 启动开发服务器: pnpm dev');
console.log('   2. 访问首页: http://localhost:3000');
console.log('   3. 登录系统: http://localhost:3000/login');
console.log('');
console.log('   默认登录账号:');
console.log('   • demo@medtrust.space / demo123456');
console.log('');

// 创建数据目录
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('✓ 创建数据目录');
}

console.log('\n💡 提示:');
console.log('   如需完整初始化数据库，请运行:');
console.log('   npx ts-node demo/data/seed.ts');
console.log('');
