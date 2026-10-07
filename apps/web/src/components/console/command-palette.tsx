"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { searchCommands, type NavCommand } from "@/lib/nav";

const kindLabel: Record<NavCommand["kind"], string> = { jump: "跳转", action: "动作", open: "打开" };

// 命令面板（⌘K / Ctrl+K）：命令全部由导航清单推导（lib/nav 的 searchCommands），只列当前角色可见的页面。
// 自绘固定层而不用 shadcn Dialog：Dialog 走 portal，会落到 .cs 作用域之外，丢失 --cs-* 令牌。
export function CommandPalette() {
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const results = useMemo(() => searchCommands(user?.role, query), [user?.role, query]);

  const reset = () => {
    setQuery("");
    setIndex(0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        reset();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = (command: NavCommand | undefined) => {
    if (!command) return;
    setOpen(false);
    router.push(command.href);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[index]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="cs-navlink w-full"
        style={{ borderColor: "var(--cs-line)" }}
        aria-label="打开命令面板"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Search size={15} />
        <span className="flex-1 text-left">搜索 / 跳转</span>
        <span className="cs-label" style={{ fontSize: "0.56rem" }}>⌘K</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4"
          style={{ background: "color-mix(in oklch, var(--cs-bg) 78%, transparent)" }}
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="命令面板"
            className="cs-panel w-full max-w-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--cs-line)" }}>
              <Search size={15} style={{ color: "var(--cs-faint)" }} />
              <input
                autoFocus
                role="combobox"
                aria-expanded="true"
                aria-controls="cs-palette-list"
                aria-activedescendant={results.length ? `cs-palette-${index}` : undefined}
                className="flex-1 bg-transparent outline-none text-sm"
                placeholder="输入页面名、动作或对象 ID"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setIndex(0);
                }}
                onKeyDown={onInputKey}
              />
              <span className="cs-label">ESC</span>
            </div>
            <ul id="cs-palette-list" role="listbox" className="max-h-80 overflow-y-auto p-1">
              {results.map((c, i) => (
                <li
                  key={`${c.kind}:${c.label}:${c.href}`}
                  id={`cs-palette-${i}`}
                  role="option"
                  aria-selected={i === index}
                  data-active={i === index}
                  className="cs-navlink cursor-pointer"
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => run(c)}
                >
                  <span className="cs-label w-9" style={{ fontSize: "0.56rem" }}>{kindLabel[c.kind]}</span>
                  <span className="flex-1">{c.label}</span>
                  <span className="cs-mono text-xs" style={{ color: "var(--cs-faint)" }}>{c.hint}</span>
                </li>
              ))}
              {results.length === 0 && <li className="px-4 py-6 text-center cs-label">没有匹配的页面或动作</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
