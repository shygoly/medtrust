// 院内 gRPC 契约文件必须真能找到：路径是手数的相对层级，数错一级就解析到仓库根之外，
// 真实客户端一构造即抛 ENOENT——而单测都注入了假 invoke，发现不了（omop-data-source-access 4.3 实测踩到）。
// src/ 与 dist/ 下同深度，这里验 src 即验 dist。
import * as fs from 'fs';
import * as path from 'path';
import { CAUSAL_PROTO_PATH } from '../causal/causal-agent-client';
import { FL_ROUND_PROTO_PATH } from './fl-round-agent-client';

describe('院内 agent 的 gRPC 契约路径', () => {
  const repoRoot = path.resolve(__dirname, '../../../../..');

  it.each([
    ['联邦训练轮次', FL_ROUND_PROTO_PATH, 'secretflow.proto'],
    ['L3 因果', CAUSAL_PROTO_PATH, 'rws_causal.proto'],
  ])('%s：指向仓库内 packages/proto 且文件存在', (_name, protoPath, file) => {
    expect(protoPath).toBe(path.join(repoRoot, 'packages', 'proto', file));
    expect(fs.existsSync(protoPath)).toBe(true);
  });

  it('联邦训练契约里有训练切片字段（连接器按合约投影后随请求给出）', () => {
    expect(fs.readFileSync(FL_ROUND_PROTO_PATH, 'utf-8')).toMatch(/string training_slice_json = 6;/);
  });
});
