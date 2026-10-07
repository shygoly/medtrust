"use client";

import { usePathname } from "next/navigation";
import { matchEntry } from "@/lib/nav";

// 页头标题的缺省来源：当前路径在导航清单里的 label（D-UI-2）。
// 菜单 tab、面包屑、命令面板、页头由此同源，改名只改清单一处。
export function NavTitle() {
  return <>{matchEntry(usePathname())?.label}</>;
}
