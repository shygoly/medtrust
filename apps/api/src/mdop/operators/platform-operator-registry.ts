/**
 * 行业包平台侧算子注册面（与 collector-registry 同一模式）。
 *
 * 基座 MUST NOT 内置行业算子清单；行业包在**组装根**把自己的平台合并算子交进来，
 * 算子注册中心在种子期一并登记、平台节点能力通告一并声明。
 * 只收 `system` + `merge`：source / declassify 是基座机制（D-MDOP-5），行业包不得以 system 身份新增。
 */
import { parseOperatorManifest, type OperatorManifest } from "@medtrust/mdop";

const operators = new Map<string, OperatorManifest>();

export function registerPlatformOperator(input: unknown): void {
  const manifest = parseOperatorManifest(input);
  if (manifest.kind !== "system" || manifest.category !== "merge") {
    throw new Error(
      `行业包平台算子 ${manifest.id}@${manifest.version} 须为 system/merge（实为 ${manifest.kind}/${manifest.category}）`,
    );
  }
  operators.set(`${manifest.id}@${manifest.version}`, manifest);
}

/** 已注册的行业包平台算子（按注册先后）。 */
export function packPlatformOperators(): OperatorManifest[] {
  return [...operators.values()];
}

export const kernelPlatformOperatorRegistry = {
  register: registerPlatformOperator,
};
