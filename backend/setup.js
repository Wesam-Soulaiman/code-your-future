const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const envPath = path.join(__dirname, '.env');

// Default values
const defaults = {
  databaseURI: 'mongodb://localhost:27017/myapp',
  appName: 'MyApp',
  appId: 'myapp12345',
  restAPIKey: generateKey(),
  masterKey: generateKey(),
  serverURL: 'http://localhost:1337/api',
  publicServerURL: 'http://localhost:1337/api',
  mountPath: '/api',
};

function generateKey(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function question(prompt, defaultValue) {
  return new Promise(resolve => {
    const displayDefault = defaultValue ? ` (${defaultValue})` : '';
    rl.question(`${prompt}${displayDefault}: `, answer => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

async function setup() {
  console.log('\n========================================');
  console.log('        Parse Server Setup');
  console.log('========================================\n');

  const config = {};

  config.appName = await question('App Name', defaults.appName);
  config.appId = await question('App ID', defaults.appId);
  config.databaseURI = await question('MongoDB URI', defaults.databaseURI);

  console.log('\n--- Security Keys ---');
  console.log('(Press Enter to auto-generate secure keys)\n');

  config.masterKey = await question('Master Key', defaults.masterKey);
  config.restAPIKey = await question('REST API Key', defaults.restAPIKey);

  console.log('\n--- Server URLs ---\n');

  config.serverURL = await question('Server URL', defaults.serverURL);
  config.publicServerURL = await question('Public Server URL', defaults.publicServerURL);
  config.mountPath = await question('Mount Path', defaults.mountPath);

  // Build .env content
  const envContent = Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // Write to .env file
  fs.writeFileSync(envPath, envContent + '\n');

  console.log('\n========================================');
  console.log('  Configuration saved to .env');
  console.log('========================================\n');
  console.log('Run "npm run dev" to start the server.\n');

  rl.close();
}

setup().catch(err => {
  console.error('Setup failed:', err);
  rl.close();
  process.exit(1);
});
