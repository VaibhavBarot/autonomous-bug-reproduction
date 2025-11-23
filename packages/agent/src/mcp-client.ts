import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
}

export interface MCPQueryResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class MCPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private connectionString: string;
  private messageId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();
  private isReady = false;
  private readOnly: boolean;
  private verbose: boolean;

  constructor(connectionString: string, readOnly: boolean = false, verbose: boolean = false) {
    super();
    this.connectionString = connectionString;
    this.readOnly = readOnly;
    this.verbose = verbose;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const env: Record<string, string | undefined> = {
        ...process.env,
        MDB_MCP_CONNECTION_STRING: this.connectionString,
        MDB_MCP_LOG_PATH: './logs/mcp'
      };

      if (this.readOnly) {
        env.MDB_MCP_READ_ONLY = 'true';
      }

      this.process = spawn('npx', ['-y', 'mongodb-mcp-server'], {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let buffer = '';

      this.process.stdout?.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const message = JSON.parse(line);
              this.handleMessage(message);
            } catch (error) {
              if (this.verbose) {
                console.error('Failed to parse MCP message:', line);
              }
            }
          }
        }
      });

      this.process.stderr?.on('data', (data) => {
        if (this.verbose) {
          console.error('MCP Server Error:', data.toString());
        }
      });

      this.process.on('error', (error) => {
        reject(new Error(`Failed to start MCP server: ${error.message}`));
      });

      this.process.on('exit', (code) => {
        this.isReady = false;
        if (code !== 0 && this.verbose) {
          console.error(`MCP server exited with code ${code}`);
        }
      });

      // Initialize connection
      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        clientInfo: {
          name: 'bugbot-agent',
          version: '1.0.0'
        }
      }).then(() => {
        this.isReady = true;
        resolve();
      }).catch(reject);

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.isReady) {
          reject(new Error('MCP server connection timeout'));
        }
      }, 10000);
    });
  }

  private handleMessage(message: any): void {
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message || 'MCP request failed'));
      } else {
        resolve(message.result);
      }
    }
  }

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        reject(new Error('MCP server not connected'));
        return;
      }

      const id = ++this.messageId;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });

      try {
        this.process.stdin.write(JSON.stringify(request) + '\n');
      } catch (error: any) {
        this.pendingRequests.delete(id);
        reject(error);
      }

      // Request timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.isReady) {
      throw new Error('MCP client not ready');
    }

    const result = await this.sendRequest('tools/list', {});
    return result.tools || [];
  }

  async callTool(toolName: string, args: any): Promise<any> {
    if (!this.isReady) {
      throw new Error('MCP client not ready');
    }

    const result = await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args
    });

    return result;
  }

  /**
   * Execute a MongoDB query
   * @param collection Collection name
   * @param query MongoDB query object
   * @param options Query options (limit, sort, etc.)
   */
  async query(collection: string, query: any = {}, options: any = {}): Promise<MCPQueryResult> {
    try {
      const result = await this.callTool('mongodb_find', {
        collection,
        query: JSON.stringify(query),
        ...options
      });

      return {
        success: true,
        data: result.content?.[0]?.text ? JSON.parse(result.content[0].text) : result
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get a single document from a collection
   * @param collection Collection name
   * @param query MongoDB query object
   */
  async findOne(collection: string, query: any = {}): Promise<MCPQueryResult> {
    return this.query(collection, query, { limit: 1 });
  }

  /**
   * List all collections in the database
   */
  async listCollections(): Promise<MCPQueryResult> {
    try {
      const result = await this.callTool('mongodb_list_collections', {});

      return {
        success: true,
        data: result.content?.[0]?.text ? JSON.parse(result.content[0].text) : result
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get schema information for a collection
   * @param collection Collection name
   */
  async getSchema(collection: string): Promise<MCPQueryResult> {
    try {
      const result = await this.callTool('mongodb_get_schema', {
        collection
      });

      return {
        success: true,
        data: result.content?.[0]?.text ? JSON.parse(result.content[0].text) : result
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute an aggregation pipeline
   * @param collection Collection name
   * @param pipeline Aggregation pipeline stages
   */
  async aggregate(collection: string, pipeline: any[]): Promise<MCPQueryResult> {
    try {
      const result = await this.callTool('mongodb_aggregate', {
        collection,
        pipeline: JSON.stringify(pipeline)
      });

      return {
        success: true,
        data: result.content?.[0]?.text ? JSON.parse(result.content[0].text) : result
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.isReady = false;
    }
  }

  isConnected(): boolean {
    return this.isReady;
  }
}


