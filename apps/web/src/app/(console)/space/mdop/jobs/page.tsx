"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Panel } from "@/components/console/ui";
import { api } from "@/api/client";

/**
 * MDOP 作业列表（mdop-kernel §9.6）。
 *
 * 只看「平台的作业内核视角」：作业、阶段、片段、凭证、回执。结果展示复用既有 L1.5 组件
 * （列表页只给状态与入口，详情页才知道具体分析类型）。
 */
export default function MdopJobsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["mdop-jobs"],
    queryFn: () => api.listMdopJobs(),
  });

  return (
    <div>
      <PageHeader
        kicker="MDOP · 作业内核"
        title="MDOP 作业"
        desc="每个作业由「注册算子组成的阶段」执行：各院本地复核并签名 → 平台签发执行凭证 → 执行 → C3 投递 → 平台合并 → 销毁。"
      />
      <div className="p-8 space-y-4">
        <Panel>
          <h3 className="text-sm mb-2" style={{ color: "var(--cs-dim)" }}>通道说明</h3>
          <p className="text-[0.78rem]" style={{ color: "var(--cs-dim)" }}>
            本页展示的是 MDOP 通道的作业。旧管线（RWS 任务页）在同一数据上走内置实现；
            未触发小单元格抑制时，两条通道的四格表与 PRR/ROR/IC 逐字段一致。
            作业进入终态后，各院制品的销毁回执与审计回执链可在作业详情里核对。
          </p>
        </Panel>

        {isLoading ? (
          <p className="text-sm" style={{ color: "var(--cs-dim)" }}>
            加载中…
          </p>
        ) : error ? (
          <p className="text-sm" style={{ color: "var(--cs-red)" }}>
            读取失败：{(error as Error)?.message}
          </p>
        ) : (data ?? []).length === 0 ? (
          <p className="text-sm" style={{ color: "var(--cs-dim)" }}>
            暂无 MDOP 作业。可从「发起 RWS 任务 → L1.5 失衡信号」勾选「经 MDOP 执行」提交。
          </p>
        ) : (
          <Panel>
          <h3 className="text-sm mb-2" style={{ color: "var(--cs-dim)" }}>作业</h3>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--cs-dim)" }}>
                  <th className="text-left py-1">作业</th>
                  <th className="text-left py-1">用途</th>
                  <th className="text-left py-1">状态</th>
                </tr>
              </thead>
              <tbody>
                {(data as Array<{ id: string; purpose?: string; status?: string }>).map((job) => (
                  <tr key={job.id} style={{ borderTop: "1px solid var(--cs-line)" }}>
                    <td className="py-1.5">
                      <Link href={`/space/mdop/jobs/${job.id}`} style={{ color: "var(--cs-accent)" }}>
                        {job.id}
                      </Link>
                    </td>
                    <td className="py-1.5">{job.purpose ?? "—"}</td>
                    <td className="py-1.5">{job.status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>
    </div>
  );
}
