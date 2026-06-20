import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { capabilityEntities } from './index';
import { seedCapability, SeedReport } from './seeder';

// 默认: 灌入真实 AppDataSource(./data/medtrust.db,或 DATABASE_URL)。
// --check: 内存库自检(验证转写计数 + 打印悬空引用报告),不写真库。
function printReport(report: SeedReport): void {
  console.log('— 各层落库行数 —');
  for (const [table, n] of Object.entries(report.inserted)) console.log(`  ${table}: ${n}`);
  const { total, resolved, dangling } = report.refs;
  console.log(`— 跨层引用解析(warn-only): ${resolved}/${total} 解析, ${dangling.length} 悬空 —`);
  for (const d of dangling) console.log(`  ⚠ ${d.ctx} → '${d.ref}'`);
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const ds: DataSource = check
    ? new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: capabilityEntities, synchronize: true })
    : AppDataSource;

  if (!check) {
    const existing = (AppDataSource.options.entities ?? []) as Function[];
    AppDataSource.setOptions({ entities: [...existing, ...capabilityEntities] });
  }

  await ds.initialize();
  const report = await seedCapability(ds);
  printReport(report);
  await ds.destroy();
  console.log(check ? '✓ capability seed self-check passed' : '✓ capability seed done');
}

main().catch((e) => { console.error(e); process.exit(1); });
