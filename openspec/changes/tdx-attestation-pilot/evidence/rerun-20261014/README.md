# 复跑：真实 TDX 端到端作业（2026-10-14）

> 与 2026-10-07 试点（`RECORD.md`）同一形态，**在重启后的 teeA/teeB 上重新跑通**。
> 结构化记录见 [job-record.json](./job-record.json)。

## 事实

- 作业 `job-mv803zdr-fa81d696`（模板 `rws.vaccine-scri`），11:02:57 提交 → 11:05:49 `PURGED`，**约 3 分钟**。
- 6 阶段全 `SUCCEEDED`：疾控封存 / 医院封存 / **飞地内 `rws.vaccine-scri`** / **飞地内降密**。
- **真实 TDX**：两条 `cp_mdop_attestation` 记录，`kind=tdx`、`tcb=5.1.3`、
  `measurement=sm3:1476196…f9a2ce2`（与 `tee-node -- probe` 一致）、作业专属 `quoteDigest=sm3:b4f32416…`。
- C3 出域结果：4 层，`doses` 1795/1737/2286/2168，`suppressedTotal=0`（`minCell=5` 闸通过），预算 `spent=1/limit=5`。
- 回执：三节点 `audit`（带 `prevHash` 链）+ 三节点 `purge`（销毁）。
- 上链：`kind=node-attestation`、`txHash=5cb27db5…`、**区块 1071**。

## 复现要点（本次实际执行）

1. 启动实例（需要 `ecs:StartInstance`；`.secrets/aliyun.env` 的 carbon 凭据即可）：
   `aliyun ecs StartInstance --RegionId cn-beijing --InstanceId i-2ze8qci4r5ec6trmywi0`（teeA）、`…i-2zegnqenh9yx2e0g2c8o`（teeB）。
2. 取新公网 IP（Stop 会释放旧 IP）：`aliyun ecs DescribeInstanceAttribute --RegionId cn-beijing --InstanceId <id>`。
3. 同步 ali29 `/etc/kms-tunnel.env` 的 `TEEA_HOST` 并 `systemctl restart kms-tunnel`；判据是 `ss -lntp | grep 15024` 三个网关监听都在。
4. 确认三处 KMS 标识相等（teeA `TEE_NODE_KMS_REF` = teeB verifier = 三院 `CONNECTOR_MDOP_KMS_REF` = `kms://verifier-domain-b`）。
5. 合约必须**已签署**（`cp_digital_contract.mdopStatus=active`）且带 TEE 证明策略；本次线上缺 `ruijin`（只有未签署的 `demohospb`），故从 20261008 备份恢复。
6. 提交 → 编译 → 观察：`mt research@meddata-inst.edu.cn POST /mdop/jobs/vaccine-scri body.json`、`POST /mdop/jobs/<id>/compile`、`GET /mdop/jobs/<id>`。

## 与试点的差异

- 试点用 `p-ruijin` 作示范乙；当前仓库 demo-scenario 已改为 `p-demohospb`，但**线上部署的连接器仍是 ruijin**，故本次按部署现实用 ruijin。
- 上链区块从试点的 179/180/181 变为 1071（链在继续增长，不是新链）。
