/**
 * 单测装配：把行业包声明的平台侧聚合收集器接进基座注册表。
 *
 * 与 `apps/api/src/app.module.ts` 的组装根注册**同源**：生产走组装根，单测走这里（jest `setupFiles`，
 * 每个测试文件执行一次、与测试文件同一模块注册表，所以测试里 import 的注册表能看到这次注册）。
 * 缺它的话，合并路径会 fail-closed 报「没有注册的聚合收集器」——这正是契约要的行为，不是意外。
 */
import { registerMedCollectors, registerMedTemplates } from "@medtrust/domain-med";

import { kernelCollectorRegistry } from "../mdop/operators/collector-registry";
import { kernelTemplateRegistry } from "../mdop/template-registry";

registerMedCollectors(kernelCollectorRegistry);
registerMedTemplates(kernelTemplateRegistry);
