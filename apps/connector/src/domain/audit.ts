import { Injectable, Optional, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LocalAuditLog } from '@medtrust/database';
import { sm3Fingerprint } from './sm3';

export interface AuditEntry {
  action: string;
  actor: string;
  allowed: boolean;
  detail?: string;
  at: Date;
  entryHash?: string;
  prevHash?: string;
}

export interface AuditDigest {
  count: number;
  firstPrevHash: string;
  lastEntryHash: string | null;
}

// 连接器本地审计日志(connector-local)。record() 保持同步(调用方 fire-and-forget),
// 内部链式 SM3 哈希(entryHash/prevHash)并异步落 local_audit_log 表;重启后 onModuleInit
// 载入既有条目(内存态 → 持久化)。digest() 产出可上报平台的链摘要。
@Injectable()
export class AuditService implements OnModuleInit {
  private entries: AuditEntry[] = [];
  private prevHash = 'GENESIS';

  constructor(
    @Optional()
    @InjectRepository(LocalAuditLog)
    private readonly repo?: Repository<LocalAuditLog>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.repo) return;
    const rows = await this.repo.find({ order: { at: 'ASC' } });
    this.entries = rows.map((r) => ({
      action: r.action,
      actor: r.actor,
      allowed: r.allowed,
      detail: r.detail ?? undefined,
      at: r.at,
      entryHash: r.entryHash ?? undefined,
      prevHash: r.prevHash ?? undefined,
    }));
    if (rows.length) this.prevHash = rows[rows.length - 1].entryHash ?? 'GENESIS';
  }

  record(e: Omit<AuditEntry, 'at' | 'entryHash' | 'prevHash'>): void {
    const entryHash = sm3Fingerprint(
      `${this.prevHash}:${e.action}:${e.actor}:${e.allowed}:${e.detail ?? ''}`,
    );
    const entry: AuditEntry = { ...e, at: new Date(), entryHash, prevHash: this.prevHash };
    this.entries.push(entry);
    this.prevHash = entryHash;
    if (this.repo) {
      this.repo
        .save(
          this.repo.create({
            action: e.action,
            actor: e.actor,
            allowed: e.allowed,
            detail: e.detail,
            entryHash,
            prevHash: entry.prevHash,
          }),
        )
        .catch(() => {
          /* 持久化失败不阻断同步执行路径 */
        });
    }
  }

  all(): AuditEntry[] {
    return [...this.entries];
  }

  blocked(): AuditEntry[] {
    return this.entries.filter((e) => !e.allowed);
  }

  // 链摘要:count + 链头 prevHash + 链尾 entryHash。平台据 firstPrevHash/lastEntryHash
  // 与前一次摘要对拍,判断链条是否连续。
  digest(): AuditDigest {
    const last = this.entries[this.entries.length - 1];
    return {
      count: this.entries.length,
      firstPrevHash: this.entries[0]?.prevHash ?? 'GENESIS',
      lastEntryHash: last?.entryHash ?? null,
    };
  }
}
