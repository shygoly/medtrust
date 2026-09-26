import {
  MdopError,
  parseMdopContract,
  publicKeyKid,
  sm2Verify,
  type MdopContract,
} from '@medtrust/mdop';

/**
 * 节点侧的**合约副本**（任务 3.15）。
 *
 * 节点凭什么信一份合约？两条签名都要过，且公钥来源**都不取自消息本身**：
 *  ① **平台副署**：用部署配置里的平台节点公钥验——平台是合约的副署方，这是节点已有的信任锚；
 *  ② **持有方签名**：用该持有方**登记在册**的公钥验，并要求公钥的 `kid` 与合约条款里的
 *     `provider_public_key_kid` 一致——否则「换个公钥再签一遍」就能把条款改掉。
 *
 * 为什么不能只验平台副署：那样平台就能替持有方「补一份」合约（持有方从未签过）。
 * 为什么不能只验持有方：那样节点无法确认条款经过平台副署（平台收齐各方签名的那一步）。
 *
 * 取得路径（本类只做**验签与存档**，取哪条路是装配方的事）：
 *  ① 复用既有 `ContractOffer/Accept` 流程（节点作为参与方收一份带双签的 canonical）；
 *  ② 平台在要约/中继时随消息下发 canonical + 两份签名（本仓 `describeForNode` 已有该形状）。
 * 两种都不改变本类的判据——**判据只有这一份**。
 */

export interface NodeContractCopy {
  contractId: string;
  canonical: string;
  contract: MdopContract;
  /** 持有方公钥（用于事后复核与审计）。 */
  holderPublicKeyKid: string;
  verifiedAt: string;
}

export class NodeContractStore {
  private readonly copies = new Map<string, NodeContractCopy>();

  /**
   * 验签后存档。任一项不过即拒（fail-closed），**不留半份副本**。
   * @param platformPublicKey 部署配置里的平台节点公钥（MUST NOT 取自消息）
   * @param holderPublicKey 该持有方登记在册的公钥（MUST 其 kid 与合约条款一致）
   */
  verifyAndStore(input: {
    canonical: string;
    holderSignature: string;
    platformCountersignature: string;
    platformPublicKey: string;
    holderPublicKey: string;
    now?: Date;
  }): NodeContractCopy {
    if (!input.platformPublicKey)
      throw new MdopError('E_AUTH_INVALID', {}, '未配置平台公钥：无法核验合约副署');
    if (!input.holderPublicKey)
      throw new MdopError('E_AUTH_INVALID', {}, '缺少持有方登记公钥：无法核验合约签名');

    let contract: MdopContract;
    try {
      contract = parseMdopContract(JSON.parse(input.canonical) as unknown);
    } catch (err) {
      throw new MdopError('E_CONTRACT_UNSIGNED', {}, `合约条款非法：${(err as Error).message}`);
    }

    // ① 平台副署（信任锚来自部署配置）
    if (!sm2Verify(input.canonical, input.platformCountersignature, input.platformPublicKey))
      throw new MdopError('E_CONTRACT_UNSIGNED', {}, '平台副署验签失败（合约被改过或不是该平台签的）');

    // ② 持有方签名 + 公钥指纹必须与条款里登记的一致
    if (publicKeyKid(input.holderPublicKey) !== contract.provider_public_key_kid)
      throw new MdopError(
        'E_CONTRACT_UNSIGNED',
        {},
        '持有方公钥与合约条款登记的指纹不符（不得用别的公钥顶替）',
      );
    if (!sm2Verify(input.canonical, input.holderSignature, input.holderPublicKey))
      throw new MdopError('E_CONTRACT_UNSIGNED', {}, '持有方签名验签失败（条款被改过）');

    const copy: NodeContractCopy = {
      contractId: contract.contract_id,
      canonical: input.canonical,
      contract,
      holderPublicKeyKid: contract.provider_public_key_kid,
      verifiedAt: (input.now ?? new Date()).toISOString(),
    };
    this.copies.set(contract.contract_id, copy);
    return copy;
  }

  get(contractId: string): NodeContractCopy | undefined {
    return this.copies.get(contractId);
  }

  list(): NodeContractCopy[] {
    return [...this.copies.values()];
  }

  /**
   * 取「可喂给节点会话」的合约条款；**没有验过的副本就一律拒**（fail-closed）。
   * `allowed_ops` 与 `data_product_id` 都来自这份验过的条款，不从消息里取。
   */
  requireForSession(contractId: string): {
    contract_id: string;
    data_product_id: string;
    allowed_ops: string[];
    attestation_policy?: MdopContract['attestation_policy'];
    recipients: string[];
  } {
    const copy = this.copies.get(contractId);
    if (!copy)
      throw new MdopError('E_CONTRACT_UNSIGNED', {}, `本节点没有验过的合约副本：${contractId}`);
    return {
      contract_id: copy.contract.contract_id,
      data_product_id: copy.contract.data_product_id,
      allowed_ops: [...copy.contract.allowed_ops],
      ...(copy.contract.attestation_policy
        ? { attestation_policy: copy.contract.attestation_policy }
        : {}),
      recipients: copy.contract.recipients.map((r) => r.party),
    };
  }
}
