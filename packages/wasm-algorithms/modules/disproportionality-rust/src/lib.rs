//! L1.5 失衡检测 —— Rust 源码模块（third-party-module-admission，Tier B 形态）。
//!
//! 与 AssemblyScript 版逐字段等价：把宿主写进线性内存的 0/1 标记列折算成每个
//! 事件词条的 2×2 计数 (a/b/c/d) 与入组人数。模块**不接收**词条文本、主体标识
//! 或任何其他记录字段 —— 词条文本留在宿主一侧，宿主按下标回填。
//!
//! ABI v1（小端）：
//!   run(in_off: i32, n: i32, k: i32, out_off: i32) -> i32   (0 = 成功)
//!   输入 @in_off:  [included: u8[n]] [exposed: u8[n]] [events: u8[n*k]] (行优先)
//!   输出 @out_off: [cohort_size: u32] [a,b,c,d: u32 * k]
//!
//! 零能力：no_std、无 panic 运行时、不导入任何函数/表/全局量，内存由宿主
//! 通过 `--import-memory` 注入（有上限、可回收）。
#![no_std]

use core::panic::PanicInfo;

/// panic = abort，且 no_std 下不引入格式化机器 —— 保证产物里没有任何
/// 能把信息写出去的路径（连 panic 消息都不存在）。
#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

/// ABI 版本。导出为 wasm **函数**（Rust/wasm-ld 无法把 `static` 导成值型常量
/// 全局 —— 它导的是地址）。宿主两种形态都认，见 static-gate 的导出校验。
#[no_mangle]
pub extern "C" fn abi_version() -> i32 {
    1
}

#[inline(always)]
unsafe fn load_u8(off: i32, i: i32) -> u8 {
    *((off + i) as usize as *const u8)
}

#[inline(always)]
unsafe fn store_u32(off: i32, value: u32) {
    *(off as usize as *mut u32) = value;
}

#[no_mangle]
pub extern "C" fn run(in_off: i32, n: i32, k: i32, out_off: i32) -> i32 {
    if n < 0 || k < 0 || in_off < 0 || out_off < 0 {
        return 1;
    }
    let included_off = in_off;
    let exposed_off = in_off + n;
    let events_off = in_off + 2 * n;

    let mut cohort_size: i32 = 0;
    let mut n_drug: i32 = 0;
    unsafe {
        let mut i = 0;
        while i < n {
            if load_u8(included_off, i) != 0 {
                cohort_size += 1;
                if load_u8(exposed_off, i) != 0 {
                    n_drug += 1;
                }
            }
            i += 1;
        }
        let n_no_drug = cohort_size - n_drug;
        store_u32(out_off, cohort_size as u32);

        let mut j = 0;
        while j < k {
            let mut a: i32 = 0;
            let mut c: i32 = 0;
            let mut i = 0;
            while i < n {
                if load_u8(included_off, i) != 0 && load_u8(events_off, i * k + j) != 0 {
                    if load_u8(exposed_off, i) != 0 {
                        a += 1;
                    } else {
                        c += 1;
                    }
                }
                i += 1;
            }
            let base = out_off + 4 + j * 16;
            store_u32(base, a as u32);
            store_u32(base + 4, (n_drug - a) as u32);
            store_u32(base + 8, c as u32);
            store_u32(base + 12, (n_no_drug - c) as u32);
            j += 1;
        }
    }
    0
}
