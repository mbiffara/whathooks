/**
 * MCP server config for agents. Stored on Agent.mcpServers (Json) with the
 * auth token encrypted; delivered to the provider (Anthropic's MCP connector,
 * OpenAI's hosted `mcp` tool on the Responses API), which connects to the
 * server FROM its own infrastructure — our servers never call these URLs.
 * Any provider, including included-token agents; Pro+ plans.
 */

/** Stored shape (Json column). */
export interface AgentMcpServer {
  name: string;
  url: string;
  authTokenCiphertext?: string;
  authTokenHint?: string;
}

/** Wire shape accepted from clients. `authToken` omitted on update = keep. */
export interface McpServerInput {
  name: string;
  url: string;
  authToken?: string;
}

export const MAX_MCP_SERVERS = 5;
export const MCP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

/** Validate a submitted server list; returns an error message or null. */
export function mcpServersError(servers: McpServerInput[]): string | null {
  if (servers.length > MAX_MCP_SERVERS) {
    return `At most ${MAX_MCP_SERVERS} MCP servers are allowed`;
  }
  const seen = new Set<string>();
  for (const server of servers) {
    if (!MCP_NAME_RE.test(server.name)) {
      return `Invalid MCP server name "${server.name}" (letters, digits, - and _ only)`;
    }
    if (seen.has(server.name)) {
      return `Duplicate MCP server name "${server.name}"`;
    }
    seen.add(server.name);
    let url: URL;
    try {
      url = new URL(server.url);
    } catch {
      return `Invalid URL for MCP server "${server.name}"`;
    }
    if (url.protocol !== 'https:') {
      return `MCP server "${server.name}" must use an https:// URL`;
    }
  }
  return null;
}

/** Structural check for values loaded back from the Json column. */
export function isAgentMcpServers(value: unknown): value is AgentMcpServer[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (s) =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as AgentMcpServer).name === 'string' &&
        typeof (s as AgentMcpServer).url === 'string',
    )
  );
}
