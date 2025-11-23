// Simple test script to trigger webhook locally without signature verification
const axios = require('axios');

async function testWebhook() {
  try {
    console.log('Testing webhook at http://localhost:3002/webhook...\n');
    
    const response = await axios.post('http://localhost:3002/webhook', {
      action: 'opened',
      number: 4,
      pull_request: {
        number: 4,
        head: {
          ref: 'test-branch',
          repo: {
            clone_url: 'https://github.com/VaibhavBarot/autonomous-bug-reproduction.git'
          }
        }
      },
      repository: {
        name: 'test-repo',
        owner: {
          login: 'VaibhavBarot'
        },
        clone_url: 'https://github.com/VaibhavBarot/autonomous-bug-reproduction.git'
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'pull_request'
      }
    });
    
    console.log('✅ Success!');
    console.log('Status:', response.status);
    console.log('Response:', response.data);
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

testWebhook();

