// Crash-safe journal of in-flight payments. Holds only ids and stages: no keys, no signatures, no wallet history.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Stage = 'intent' | 'ordered' | 'prepared' | 'signed' | 'submitted' | 'pending' | 'settled' | 'closed';

export interface JournalEntry {
  key: string;
  intentId: string;
  merchant: string;
  amount: string;
  stage: Stage;
  flowId?: string;
  paymentRequestId?: string;
  cartHash?: string;
  updatedAt: string;
}

export interface Journal {
  get(key: string): JournalEntry | undefined;
  put(e: JournalEntry): void;
  open(): JournalEntry[];
}

export class MemoryJournal implements Journal {
  rows = new Map<string, JournalEntry>();
  get(key: string) { return this.rows.get(key); }
  put(e: JournalEntry) { this.rows.set(e.key, { ...e }); }
  open() { return [...this.rows.values()].filter((e) => e.stage !== 'settled' && e.stage !== 'closed'); }
}

/** JSON file journal; write-to-temp then rename so a crash never leaves half a file. */
export class FileJournal implements Journal {
  path: string;
  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }
  private load(): Record<string, JournalEntry> {
    try { return JSON.parse(readFileSync(this.path, 'utf8')); } catch { return {}; }
  }
  get(key: string) { return this.load()[key]; }
  put(e: JournalEntry) {
    const all = this.load();
    all[e.key] = e;
    writeFileSync(`${this.path}.tmp`, JSON.stringify(all, null, 2));
    renameSync(`${this.path}.tmp`, this.path);
  }
  open() { return Object.values(this.load()).filter((e) => e.stage !== 'settled' && e.stage !== 'closed'); }
}
