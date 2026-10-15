/**
 * 单测装配：给「需要 AE 语义」的 spec 一个走 MDOP 新接线的执行器（与 demo 里 `createMdopRwsExecutor` 同源）。
 * 旧接线删除后（change `mdop-rws-ladder-migration` 4.3），spec 不再直接依赖 `RwsExecutor` 的类型分支。
 */
import * as path from 'path';
import { Deidentifier } from '../domain/deidentifier';
import { LocalStore } from '../domain/local-store';
import { RwsExecutor } from '../domain/rws-executor';
import { createMdopRwsExecutor, type MdopLocalRunContext } from '../wiring/wire-mdop-rws';

export function createTestMdopExecutor(options: {
  id: string;
  store: LocalStore;
  categoryKeys?: string[];
  minCell?: number;
}) {
  const legacy = new RwsExecutor(options.store, new Deidentifier());
  const context: MdopLocalRunContext = {
    spaceId: 'sh-med',
    participantId: options.id,
    dataProductId: `dp-${options.id}`,
    contractId: `c-${options.id}`,
    purpose: '药物警戒',
    minCell: options.minCell ?? 5,
    ...(options.categoryKeys ? { categoryKeys: options.categoryKeys } : {}),
  };
  return createMdopRwsExecutor({
    legacy,
    context,
    moduleDir: path.resolve(__dirname, '../../../../packages/wasm-algorithms/build'),
    withRows: (fn) => options.store.aggregateInternal({ origin: 'internal', actor: 'mdop-test' }, fn as never),
    holder: `urn:tds:sh-med:participant:${options.id}`,
  });
}
