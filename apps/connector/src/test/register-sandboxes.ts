/**
 * 单测装配：把行业包声明的**节点侧阶段沙箱**接进基座注册表（与 app.module.ts 的组装根注册同源）。
 * 缺它的话，未注册的算子会回落到内置分支或在前置白名单处被拒——这正是契约要的行为，不是意外。
 */
import { registerMedSandboxes } from '@medtrust/domain-med';
import { registerPowerSandboxes } from '@medtrust/domain-power';

import { kernelSandboxRegistry } from '../tee-node/sandbox-registry';

registerMedSandboxes(kernelSandboxRegistry);
registerPowerSandboxes(kernelSandboxRegistry);
