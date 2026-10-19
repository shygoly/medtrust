import { DataSource } from "typeorm";
import { connectorEntities, controlPlaneEntities } from "@medtrust/database";

/**
 * 真实驱动下的实体元数据校验（P1.5 回归）。
 *
 * 为什么必须有这一条：绝大多数单测用 mockRepo，**不经过 TypeORM 元数据校验**，
 * 于是「列类型被推断成 Object」这类缺陷会整片漏网。线上实测事故：
 * `SpaceScoped.spaceId` 只写 `@Column({ nullable: true })`，属性类型是
 * `string | null` → design:type = Object → better-sqlite3 在
 * `DataSource.buildMetadatas` 抛 `DataTypeNotSupportedError`，控制面起不来（health 000）。
 *
 * 这里只 **构建并校验元数据**（不建立连接），因此不依赖 better-sqlite3 原生绑定，
 * 却恰好覆盖出错的代码路径（EntityMetadataValidator.validateMany）。
 */
async function assertMetadataBuilds(entities: unknown[], label: string) {
  const ds = new DataSource({
    type: "postgres",
    url: "postgres://metadata:metadata@127.0.0.1:1/metadata",
    entities: entities as never,
    synchronize: false,
  });
  await (ds as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
  const built = (ds as unknown as { entityMetadatas: unknown[] })
    .entityMetadatas;
  expect(built.length).toBe(entities.length);
  expect(label).toBeTruthy();
}

describe("实体元数据（真实驱动校验，非 mockRepo）", () => {
  it("控制面实体元数据可构建（无 unsupported data type）", async () => {
    await assertMetadataBuilds(controlPlaneEntities, "control-plane");
  });

  it("连接器本地实体元数据可构建", async () => {
    await assertMetadataBuilds(connectorEntities, "connector-local");
  });
});
