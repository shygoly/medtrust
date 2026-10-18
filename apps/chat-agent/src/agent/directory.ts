/**
 * 目录（参与方 / 数据产品）选项。工具层与场景层共用的最小投影。
 */
export interface ParticipantOption {
  id: string;
  name: string;
}

export interface DataProductOption {
  id: string;
  name: string;
  ownerId?: string;
  /** 目录显式声明的产品角色标签；不从标题推断。 */
  roles?: string[];
}

export interface SpaceDirectory {
  participants: ParticipantOption[];
  dataProducts: DataProductOption[];
}

export const EMPTY_DIRECTORY: SpaceDirectory = { participants: [], dataProducts: [] };
