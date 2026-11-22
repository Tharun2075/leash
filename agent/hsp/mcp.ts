// Live HSP adapter over MCP Streamable HTTP (https://mcp-qa.hashkeymerchant.com/).
// STATUS: pending-allowlist. HSP QA only answers allowlisted egress IPs; the guide says to pause, not retry,
// until HSP Operations confirms. So this adapter refuses to open any connection unless
// HSP_ALLOWLIST_CONFIRMED=1 is set by the human after HSP confirms.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { HspTools, ToolName } from './types.ts';
import { HspError, REQUIRED_TOOLS } from './types.ts';

export const HSP_QA_URL = 'https://mcp-qa.hashkeymerchant.com/';

export class AllowlistPendingError extends Error {
  constructor() {
    super('HSP QA allowlist not confirmed: set HSP_ALLOWLIST_CONFIRMED=1 only after HSP Operations confirms our egress IP. Not connecting.');
    this.name = 'AllowlistPendingError';
  }
}

export class MissingToolError extends Error {
  constructor(missing: string[]) {
    super(`HSP MCP server is missing required tools: ${missing.join(', ')}. Stopping (guide: never proceed without finalize_payment).`);
    this.name = 'MissingToolError';
  }
}

type AnyArgs = Record<string, unknown>;

export class McpHspAdapter implements HspTools {
  private client?: Client;
  private names = new Map<ToolName, string>();
  schemas = new Map<string, unknown>();
  url: string;

  constructor(url: string = HSP_QA_URL) {
    this.url = url;
  }

  /** Connect once, list tools, map client prefixes to the eight tool names, keep live input schemas. */
  async connect(): Promise<void> {
    if (process.env.HSP_ALLOWLIST_CONFIRMED !== '1') throw new AllowlistPendingError();
    const client = new Client({ name: 'leash-agent', version: '0.1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(this.url)));
    const { tools } = await client.listTools();
    const missing: string[] = [];
    for (const want of REQUIRED_TOOLS) {
      const hit = tools.find((t) => t.name === want || t.name.endsWith(`__${want}`) || t.name.endsWith(`.${want}`));
      if (!hit) missing.push(want);
      else {
        this.names.set(want, hit.name);
        this.schemas.set(want, hit.inputSchema);
      }
    }
    if (missing.length) {
      await client.close();
      throw new MissingToolError(missing);
    }
    this.client = client;
  }

  async close(): Promise<void> {
    await this.client?.close();
  }

  private async call<T>(tool: ToolName, args: AnyArgs): Promise<T> {
    if (!this.client) throw new Error('McpHspAdapter.connect() first');
    const res = await this.client.callTool({ name: this.names.get(tool) as string, arguments: args });
    const content = (res.content ?? []) as Array<{ type: string; text?: string }>;
    const text = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep raw text; surfaced unchanged below
    }
    if (res.isError) {
      const code = /\b(\d{5})\b/.exec(text)?.[1] ?? 'unknown';
      throw new HspError(code, text);
    }
    if (res.structuredContent) return res.structuredContent as T;
    return body as T;
  }

  get_chain_config() { return this.call<Awaited<ReturnType<HspTools['get_chain_config']>>>('get_chain_config', {}); }
  create_order(a: Parameters<HspTools['create_order']>[0]) { return this.call<Awaited<ReturnType<HspTools['create_order']>>>('create_order', a as unknown as AnyArgs); }
  get_order(a: { flow_id: string }) { return this.call<unknown>('get_order', a); }
  prepare_payment(a: Parameters<HspTools['prepare_payment']>[0]) { return this.call<Awaited<ReturnType<HspTools['prepare_payment']>>>('prepare_payment', a); }
  finalize_payment(a: Parameters<HspTools['finalize_payment']>[0]) { return this.call<Awaited<ReturnType<HspTools['finalize_payment']>>>('finalize_payment', a); }
  estimate_fee(a: AnyArgs) { return this.call<unknown>('estimate_fee', a); }
  submit_payment(a: Parameters<HspTools['submit_payment']>[0]) { return this.call<Awaited<ReturnType<HspTools['submit_payment']>>>('submit_payment', a); }
  query_payment(a: Parameters<HspTools['query_payment']>[0]) { return this.call<Awaited<ReturnType<HspTools['query_payment']>>>('query_payment', a); }
}
