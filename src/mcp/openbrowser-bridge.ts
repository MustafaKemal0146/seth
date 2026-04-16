// OpenBrowser MCP bridge - şimdilik devre dışı (@openbrowser-ai/core npm'de yok)
export class OpenBrowserMcpBridge {
  async connectSSE(url: string): Promise<void> {
    throw new Error('OpenBrowser MCP henüz desteklenmiyor');
  }
  async connectHTTP(url: string): Promise<void> {
    throw new Error('OpenBrowser MCP henüz desteklenmiyor');
  }
  async listTools(): Promise<string[]> { return []; }
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    throw new Error('OpenBrowser MCP henüz desteklenmiyor');
  }
  async disconnect(): Promise<void> {}
}
