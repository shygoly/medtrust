/**
 * 规格与校验已下移到行业包（FL 迁移 tasks 7.2）：此处**再导出**，既有调用点（compute-task / fl-orchestrator 等）不变。
 * 基座（mdop 目录）不再依赖本文件；它只把 spec 当不透明值透传。
 */
export * from "@medtrust/domain-med";
