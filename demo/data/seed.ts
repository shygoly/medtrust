/**
 * MedTrust 演示数据初始化脚本
 * 
 * 用途: 将演示数据导入数据库
 * 运行: npx ts-node demo/data/seed.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';

// 导入实体
import { Tenant, TenantType, TenantStatus } from '../../packages/database/src/entities/tenant.entity';
import { User } from '../../packages/database/src/entities/user.entity';
import { DataAsset, DataAssetType, DataAssetStatus } from '../../packages/database/src/entities/data-asset.entity';
import { ComputeTask, ComputeMethod, ComputeTaskStatus } from '../../packages/database/src/entities/compute-task.entity';
import { DataAccessRequest, AccessRequestStatus } from '../../packages/database/src/entities/access-request.entity';

// 演示数据
const demoData = {
  tenants: JSON.parse(fs.readFileSync(path.join(__dirname, 'tenants.json'), 'utf8')).tenants,
  users: JSON.parse(fs.readFileSync(path.join(__dirname, 'tenants.json'), 'utf8')).users,
  assets: JSON.parse(fs.readFileSync(path.join(__dirname, 'assets.json'), 'utf8')).assets,
  tasks: JSON.parse(fs.readFileSync(path.join(__dirname, 'tasks.json'), 'utf8')).computeTasks,
  requests: JSON.parse(fs.readFileSync(path.join(__dirname, 'tasks.json'), 'utf8')).accessRequests,
};

// 数据库连接配置
const AppDataSource = new DataSource({
  type: 'better-sqlite3',
  database: './data/medtrust-demo.db',
  entities: [Tenant, User, DataAsset, ComputeTask, DataAccessRequest],
  synchronize: true,
  logging: false,
});

async function seedDatabase() {
  console.log('🚀 开始初始化 MedTrust 演示数据...\n');
  
  try {
    await AppDataSource.initialize();
    console.log('✅ 数据库连接成功');

    // 清空现有数据
    console.log('\n📦 清空现有数据...');
    await AppDataSource.getRepository(DataAccessRequest).clear();
    await AppDataSource.getRepository(ComputeTask).clear();
    await AppDataSource.getRepository(DataAsset).clear();
    await AppDataSource.getRepository(User).clear();
    await AppDataSource.getRepository(Tenant).clear();
    console.log('✅ 数据清空完成');

    // 1. 创建租户
    console.log('\n🏢 创建演示租户...');
    const tenantRepo = AppDataSource.getRepository(Tenant);
    const createdTenants: Tenant[] = [];
    
    for (const t of demoData.tenants) {
      const tenant = tenantRepo.create({
        name: t.name,
        type: t.type as TenantType,
        status: t.status as TenantStatus,
        description: t.description,
        businessLicense: t.businessLicense,
        medicalLicense: t.medicalLicense,
        legalPersonId: t.legalPersonId,
        contactName: t.contactName,
        contactPhone: t.contactPhone,
        contactEmail: t.contactEmail,
        computeQuota: t.computeQuota,
        storageQuota: t.storageQuota,
        dataRetention: t.dataRetention,
        totalEarnings: t.totalEarnings,
        totalSpending: t.totalSpending,
        verifiedAt: new Date(t.verifiedAt),
      });
      const saved = await tenantRepo.save(tenant);
      createdTenants.push(saved);
      console.log(`  ✓ ${t.name} (${t.type})`);
    }
    console.log(`✅ 已创建 ${createdTenants.length} 个租户`);

    // 2. 创建用户
    console.log('\n👤 创建演示用户...');
    const userRepo = AppDataSource.getRepository(User);
    const createdUsers: User[] = [];
    const defaultPassword = await bcrypt.hash('demo123456', 10);
    
    for (const u of demoData.users) {
      const user = userRepo.create({
        name: u.name,
        email: u.email,
        passwordHash: defaultPassword,
        emailVerified: true,
      });
      const saved = await userRepo.save(user);
      createdUsers.push(saved);
      console.log(`  ✓ ${u.name} (${u.email})`);
    }
    console.log(`✅ 已创建 ${createdUsers.length} 个用户`);
    console.log('  🔑 默认密码: demo123456');

    // 3. 创建数据资产
    console.log('\n📊 创建数据资产...');
    const assetRepo = AppDataSource.getRepository(DataAsset);
    const createdAssets: DataAsset[] = [];
    
    for (const a of demoData.assets) {
      const asset = assetRepo.create({
        tenantId: a.tenantId,
        name: a.name,
        type: a.type as DataAssetType,
        status: a.status as DataAssetStatus,
        description: a.description,
        recordCount: a.recordCount,
        patientCount: a.patientCount,
        timeRangeStart: new Date(a.timeRangeStart),
        timeRangeEnd: new Date(a.timeRangeEnd),
        hospitalLevel: a.hospitalLevel,
        region: a.region,
        completeness: a.completeness,
        accuracy: a.accuracy,
        pricePerQuery: a.pricePerQuery,
        pricePerCompute: a.pricePerCompute,
        storageSize: a.storageSize,
        usagePolicy: a.usagePolicy,
        publishedAt: a.publishedAt ? new Date(a.publishedAt) : null,
      });
      const saved = await assetRepo.save(asset);
      createdAssets.push(saved);
      console.log(`  ✓ ${a.name} (${a.recordCount.toLocaleString()} 条)`);
    }
    console.log(`✅ 已创建 ${createdAssets.length} 个数据资产`);

    // 4. 创建访问申请
    console.log('\n📝 创建访问申请...');
    const requestRepo = AppDataSource.getRepository(DataAccessRequest);
    const createdRequests: DataAccessRequest[] = [];
    
    for (const r of demoData.requests) {
      const request = requestRepo.create({
        requesterTenantId: r.requesterTenantId,
        providerTenantId: r.providerTenantId,
        assetId: r.assetId,
        purpose: r.purpose,
        expectedDuration: r.expectedDuration,
        expectedCost: r.expectedCost,
        status: r.status as AccessRequestStatus,
        approvedBy: r.approvedBy,
        approvedAt: r.approvedAt ? new Date(r.approvedAt) : null,
        actualStartAt: r.actualStartAt ? new Date(r.actualStartAt) : null,
        actualEndAt: r.actualEndAt ? new Date(r.actualEndAt) : null,
        actualCost: r.actualCost,
      });
      const saved = await requestRepo.save(request);
      createdRequests.push(saved);
      console.log(`  ✓ 申请 #${r.id} (${r.status})`);
    }
    console.log(`✅ 已创建 ${createdRequests.length} 个访问申请`);

    // 5. 创建计算任务
    console.log('\n⚙️ 创建计算任务...');
    const taskRepo = AppDataSource.getRepository(ComputeTask);
    const createdTasks: ComputeTask[] = [];
    
    for (const t of demoData.tasks) {
      const task = taskRepo.create({
        tenantId: t.tenantId,
        requestId: t.requestId,
        name: t.name,
        description: t.description,
        method: t.method as ComputeMethod,
        status: t.status as ComputeTaskStatus,
        algorithmId: t.algorithmId,
        algorithmParams: t.algorithmParams,
        dataAssets: t.dataAssets,
        cpuHours: t.cpuHours,
        memoryGb: t.memoryGb,
        resultSummary: t.resultSummary,
        startedAt: t.startedAt ? new Date(t.startedAt) : null,
        completedAt: t.completedAt ? new Date(t.completedAt) : null,
        actualCost: t.actualCost,
      });
      const saved = await taskRepo.save(task);
      createdTasks.push(saved);
      console.log(`  ✓ ${t.name.substring(0, 30)}... (${t.method.toUpperCase()})`);
    }
    console.log(`✅ 已创建 ${createdTasks.length} 个计算任务`);

    // 统计信息
    console.log('\n' + '='.repeat(50));
    console.log('📈 演示数据初始化完成！');
    console.log('='.repeat(50));
    console.log(`
┌─────────────────────────────────────┐
│  租户数量:     ${String(createdTenants.length).padStart(4)}              │
│  用户数量:     ${String(createdUsers.length).padStart(4)}              │
│  数据资产:     ${String(createdAssets.length).padStart(4)}              │
│  访问申请:     ${String(createdRequests.length).padStart(4)}              │
│  计算任务:     ${String(createdTasks.length).padStart(4)}              │
└─────────────────────────────────────┘
`);

    console.log('🎉 演示数据已准备就绪！');
    console.log('\n🚀 启动应用:');
    console.log('   pnpm dev');
    console.log('\n🔗 访问地址:');
    console.log('   Landing Page: http://localhost:3000');
    console.log('   管理后台:     http://localhost:3000/dashboard');
    console.log('   API文档:      http://localhost:3001/api/docs');
    
    console.log('\n👤 演示账号:');
    console.log('   邮箱: demo@medtrust.space');
    console.log('   密码: demo123456');
    console.log('');

  } catch (error) {
    console.error('❌ 数据初始化失败:', error);
    process.exit(1);
  } finally {
    await AppDataSource.destroy();
  }
}

// 运行种子脚本
seedDatabase();
