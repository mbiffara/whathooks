import { isAgentMcpServers, mcpServersError } from './mcp-servers';

describe('mcpServersError', () => {
  it('accepts a valid list', () => {
    expect(
      mcpServersError([
        { name: 'linear', url: 'https://mcp.linear.app/mcp' },
        {
          name: 'my-tools',
          url: 'https://tools.example.com/mcp',
          authToken: 'x',
        },
      ]),
    ).toBeNull();
  });

  it('rejects more than the cap', () => {
    const servers = Array.from({ length: 6 }, (_, i) => ({
      name: `s${i}`,
      url: 'https://example.com/mcp',
    }));
    expect(mcpServersError(servers)).toMatch(/At most 5/);
  });

  it('rejects bad names and duplicates', () => {
    expect(
      mcpServersError([{ name: 'has spaces', url: 'https://x.com' }]),
    ).toMatch(/Invalid MCP server name/);
    expect(
      mcpServersError([
        { name: 'a', url: 'https://x.com' },
        { name: 'a', url: 'https://y.com' },
      ]),
    ).toMatch(/Duplicate/);
  });

  it('rejects non-https and unparseable URLs', () => {
    expect(
      mcpServersError([{ name: 'a', url: 'http://insecure.example.com' }]),
    ).toMatch(/https/);
    expect(mcpServersError([{ name: 'a', url: 'not a url' }])).toMatch(
      /Invalid URL/,
    );
  });
});

describe('isAgentMcpServers', () => {
  it('accepts the stored shape', () => {
    expect(
      isAgentMcpServers([
        { name: 'a', url: 'https://x.com', authTokenCiphertext: 'ct' },
      ]),
    ).toBe(true);
  });

  it('rejects empty, null, and malformed values', () => {
    expect(isAgentMcpServers([])).toBe(false);
    expect(isAgentMcpServers(null)).toBe(false);
    expect(isAgentMcpServers([{ name: 'a' }])).toBe(false);
    expect(isAgentMcpServers('nope')).toBe(false);
  });
});
