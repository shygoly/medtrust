import { config } from 'dotenv';
import { resolve } from 'node:path';

/**
 * 与 apps/api 同法：在模块导入期最早加载 `.env`（process.cwd()/.env）。
 * 必须先于任何读取 process.env 的模块求值。
 */
config({ path: resolve(process.cwd(), '.env') });
