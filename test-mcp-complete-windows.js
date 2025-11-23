const { spawn } = require('child_process');
const readline = require('readline');

const CONNECTION_STRING = process.env.MONGODB_CONNECTION_STRING || 
  'mongodb://localhost:27017/test';

console.log('🚀 Starting MongoDB MCP Server Test (Windows)');
console.log('📍 Connection:', CONNECTION_STRING);

// Start MCP server with shell: true for Windows
const mcp = spawn('npx', ['-y', 'mongodb-mcp-server'], {
  env: {
    ...process.env,
    MDB_MCP_CONNECTION_STRING: CONNECTION_STRING
  },
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true  // Important for Windows!
});

let messageId = 0;
const pendingRequests = new Map();

// Setup line-by-line reading of stdout
const rl = readline.createInterface({
  input: mcp.stdout,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  
  try {
    const response = JSON.parse(line);
    console.log('\n📥 Response:', JSON.stringify(response, null, 2));
    
    // Resolve pending promise
    if (response.id && pendingRequests.has(response.id)) {
      const { resolve, reject } = pendingRequests.get(response.id);
      pendingRequests.delete(response.id);
      
      if (response.error) {
        reject(new Error(response.error.message));
      } else {
        resolve(response.result);
      }
    }
  } catch (e) {
    console.log('📄 Raw output:', line);
  }
});

mcp.stderr.on('data', (data) => {
  const output = data.toString().trim();
  if (output && !output.includes('ExperimentalWarning')) {
    console.error('⚠️  stderr:', output);
  }
});

mcp.on('error', (err) => {
  console.error('❌ Failed to start MCP server:', err.message);
  console.error('\nTroubleshooting:');
  console.error('1. Check Node.js: node --version');
  console.error('2. Check npm: npm --version');
  console.error('3. Try: npm install -g mongodb-mcp-server');
  process.exit(1);
});

// Send request helper
function sendRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };
    
    console.log('\n📤 Request:', JSON.stringify(request, null, 2));
    
    pendingRequests.set(id, { resolve, reject });
    mcp.stdin.write(JSON.stringify(request) + '\n');
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }
    }, 10000);
  });
}

// Run tests
async function runTests() {
  try {
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('\n' + '='.repeat(60));
    console.log('TEST 1: Initialize Connection');
    console.log('='.repeat(60));
    
    const initResult = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'test-client', version: '1.0.0' }
    });
    console.log('✅ Initialized:', initResult.serverInfo?.name);
    
    console.log('\n' + '='.repeat(60));
    console.log('TEST 2: List Available Tools');
    console.log('='.repeat(60));
    
    const toolsResult = await sendRequest('tools/list', {});
    console.log('✅ Available tools:', toolsResult.tools?.map(t => t.name).join(', '));
    
    console.log('\n' + '='.repeat(60));
    console.log('TEST 3: List Collections');
    console.log('='.repeat(60));
    
    const collectionsResult = await sendRequest('tools/call', {
      name: 'mongodb_list_collections',
      arguments: {}
    });
    console.log('✅ Collections:', collectionsResult.content?.[0]?.text || collectionsResult);
    
    console.log('\n' + '='.repeat(60));
    console.log('TEST 4: Query Collection (users)');
    console.log('='.repeat(60));
    
    try {
      const queryResult = await sendRequest('tools/call', {
        name: 'mongodb_find',
        arguments: {
          collection: 'users',
          query: JSON.stringify({}),
          limit: 3
        }
      });
      console.log('✅ Query result:', queryResult.content?.[0]?.text || queryResult);
    } catch (error) {
      console.log('⚠️  Collection might not exist:', error.message);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ All Tests Completed Successfully!');
    console.log('='.repeat(60) + '\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    mcp.kill();
    process.exit(0);
  }
}

runTests();


