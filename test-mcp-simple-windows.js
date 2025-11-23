const { spawn } = require('child_process');
const path = require('path');

const connectionString = process.env.MONGODB_CONNECTION_STRING || 
  'mongodb://localhost:27017/test';

console.log('🧪 Simple MCP Server Test (Windows)');
console.log('📍 Connection:', connectionString);
console.log('⏳ Starting server...\n');

// Try to find npx in common locations
const possibleNpxPaths = [
  'npx.cmd',  // Windows uses .cmd extension
  'npx',
  path.join(process.env.APPDATA || '', 'npm', 'npx.cmd'),
  path.join(process.env.ProgramFiles || '', 'nodejs', 'npx.cmd'),
];

// Try each path
let npxCommand = 'npx.cmd';  // Default for Windows

const mcp = spawn(npxCommand, ['-y', 'mongodb-mcp-server'], {
  env: { 
    ...process.env, 
    MDB_MCP_CONNECTION_STRING: connectionString 
  },
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true  // Use shell on Windows
});

let output = '';

mcp.stdout.on('data', (data) => {
  output += data.toString();
  console.log('📤 MCP stdout:', data.toString().trim());
});

mcp.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  if (!msg.includes('ExperimentalWarning')) {
    console.error('⚠️  MCP stderr:', msg);
  }
});

setTimeout(() => {
  console.log('\n✅ MCP server started successfully!');
  console.log('Server is running and ready to accept JSON-RPC requests via stdin\n');
  
  console.log('To interact with it, you need to:');
  console.log('1. Send JSON-RPC messages to stdin');
  console.log('2. Read JSON-RPC responses from stdout');
  console.log('\nSee test-mcp-complete-windows.js for full example\n');
  
  mcp.kill();
  process.exit(0);
}, 3000);

mcp.on('error', (err) => {
  console.error('❌ Failed to start MCP:', err.message);
  console.error('\nTroubleshooting:');
  console.error('1. Make sure Node.js and npm are installed: node --version');
  console.error('2. Make sure npx is available: npx --version');
  console.error('3. Try: npm install -g npx');
  console.error('4. Or install MCP server globally: npm install -g mongodb-mcp-server');
  process.exit(1);
});

mcp.on('exit', (code) => {
  if (code !== null && code !== 0 && code !== 143 && code !== 1) {
    console.error(`❌ MCP server exited with code ${code}`);
    process.exit(code);
  }
});


