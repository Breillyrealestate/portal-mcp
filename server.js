import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
}

// Create Supabase client with service role key (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function createMCPServer() {
  const server = new McpServer({
    name: 'team-portal-mcp',
    version: '1.0.0',
  });

  // âââ TRANSACTIONS ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  server.tool(
    'list_transactions',
    'List transactions from the team portal. Optionally filter by status, agent, or address.',
    {
      status: z.string().optional().describe('Filter by transaction status (e.g. active, pending, closed, past_client, trash)'),
      agent_email: z.string().optional().describe('Filter by agent email address'),
      address: z.string().optional().describe('Search by property address (partial match)'),
      limit: z.number().optional().default(25).describe('Max results to return (default 25)'),
    },
    async ({ status, agent_email, address, limit }) => {
      let query = supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit ?? 25);

      if (status) query = query.eq('status', status);
      if (agent_email) query = query.eq('agent_email', agent_email);
      if (address) query = query.ilike('address', `%${address}%`);

      const { data, error } = await query;
      if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_transaction',
    'Get full details of a single transaction by ID.',
    {
      id: z.string().describe('Transaction UUID'),
    },
    async ({ id }) => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', id)
        .single();

      if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_transaction_showings',
    'Get all showings for a specific transaction (listing).',
    {
      transaction_id: z.string().describe('Transaction UUID'),
    },
    async ({ transaction_id }) => {
      const { data, error } = await supabase
        .from('transaction_showings')
        .select('*')
        .eq('transaction_id', transaction_id)
        .order('scheduled_date', { ascending: false });

      if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // âââ TEAM ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  server.tool(
    'list_team_members',
    'List all team members (agents and admins) in the portal.',
    {},
    async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name');

      if (error) {
        // Try user_roles or team_members table as fallback
        const { data: data2, error: error2 } = await supabase
          .from('user_roles')
          .select('*');
        if (error2) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data2, null, 2) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // âââ OPEN HOUSES âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  server.tool(
    'list_open_houses',
    'List open houses. Optionally filter by upcoming or past events.',
    {
      upcoming_only: z.boolean().optional().default(false).describe('If true, only return future open houses'),
      limit: z.number().optional().default(25).describe('Max results'),
    },
    async ({ upcoming_only, limit }) => {
      let query = supabase
        .from('open_houses')
        .select('*')
        .order('date', { ascending: false })
        .limit(limit ?? 25);

      if (upcoming_only) {
        query = query.gte('date', new Date().toISOString().split('T')[0]);
      }

      const { data, error } = await query;
      if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // âââ RECRUITING ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  server.tool(
    'list_recruiting_leads',
    'List recruiting leads/candidates. Optionally filter by stage.',
    {
      stage: z.string().optional().describe('Recruiting stage (e.g. lead, contacted, screening, interview_scheduled, interviewed, offer_extended, hired, declined, not_a_fit, archived)'),
      limit: z.number().optional().default(25).describe('Max results'),
    },
    async ({ stage, limit }) => {
      let query = supabase
        .from('recruiting_leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit ?? 25);

      if (stage) query = query.eq('recruiting_stage', stage);

      const { data, error } = await query;
      if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // âââ PIPELINE SUMMARY ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  server.tool(
    'get_portal_summary',
    'Get a high-level summary of the team portal: transaction counts by status, open houses count, recruiting pipeline counts.',
    {},
    async () => {
      const [txResult, ohResult, recResult] = await Promise.all([
        supabase.from('transactions').select('status'),
        supabase.from('open_houses').select('id', { count: 'exact', head: true }),
        supabase.from('recruiting_leads').select('recruiting_stage'),
      ]);

      const summary = {};

      // Transaction counts by status
      if (txResult.data) {
        const txCounts = {};
        for (const tx of txResult.data) {
          const s = tx.status || 'unknown';
          txCounts[s] = (txCounts[s] || 0) + 1;
        }
        summary.transactions = { total: txResult.data.length, by_status: txCounts };
      }

      // Open houses count
      summary.open_houses = { total: ohResult.count ?? 0 };

      // Recruiting pipeline
      if (recResult.data) {
        const recCounts = {};
        for (const r of recResult.data) {
          const s = r.recruiting_stage || 'unknown';
          recCounts[s] = (recCounts[s] || 0) + 1;
        }
        summary.recruiting = { total: recResult.data.length, by_stage: recCounts };
      }

      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // âââ GENERIC QUERY âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  server.tool(
    'query_table',
    'Query any table in the team portal database. Use this for tables not covered by specific tools.',
    {
      table: z.string().describe('Table name to query'),
      filters: z.record(z.string()).optional().describe('Key/value pairs to filter by (exact match)'),
      limit: z.number().optional().default(25).describe('Max results'),
      order_by: z.string().optional().describe('Column to order by'),
      ascending: z.boolean().optional().default(false).describe('Sort ascending (default false = newest first)'),
    },
    async ({ table, filters, limit, order_by, ascending }) => {
      let query = supabase.from(table).select('*').limit(limit ?? 25);

      if (order_by) query = query.order(order_by, { ascending: ascending ?? false });
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          query = query.eq(key, value);
        }
      }

      const { data, error } = await query;
      if (error) return { content: [{ type: 'text', text: `Error querying ${table}: ${error.message}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'list_tables',
    'List all available tables in the team portal database.',
    {},
    async () => {
      const { data, error } = await supabase
        .rpc('get_tables')
        .select('*');

      if (error) {
        // Fallback: query information_schema
        const { data: schemaData, error: schemaError } = await supabase
          .from('information_schema.tables')
          .select('table_name')
          .eq('table_schema', 'public');

        if (schemaError) {
          // Return known tables from the portal
          const knownTables = [
            'transactions', 'transaction_showings', 'profiles', 'user_roles',
            'open_houses', 'recruiting_leads', 'admin_onboarding_items',
          ];
          return { content: [{ type: 'text', text: `Known tables:\n${knownTables.join('\n')}` }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(schemaData, null, 2) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  return server;
}

// POST /mcp â main MCP endpoint
app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createMCPServer();
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP POST handler error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// GET /mcp â SSE endpoint (required by MCP Streamable HTTP spec)
app.get('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createMCPServer();
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error('MCP GET handler error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'team-portal-mcp',
    supabaseUrl: SUPABASE_URL ? SUPABASE_URL.replace(/https?:\/\//, '').split('.')[0] + '.supabase.co' : 'not set',
  });
});

app.listen(PORT, () => {
  console.log(`Team Portal MCP server running on port ${PORT}`);
});
