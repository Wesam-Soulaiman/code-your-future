#!/usr/bin/env node

/**
 * 90Soft Fullstack Project Creator
 *
 * Standalone script — run from any directory.
 * Clones the template, configures everything, and sets up a new project.
 *
 * Usage: node create-project.js
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const TEMPLATE_REPO = 'https://git.90-soft.com/90_soft/fullstack-template.git';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultVal) {
  return new Promise((resolve) => {
    const prompt = defaultVal ? `${question} (${defaultVal}): ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function generateKey(length = 32) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

function replaceInFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  for (const [search, replace] of replacements) {
    content = content.replace(new RegExp(search, 'g'), replace);
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

async function main() {
  console.log('\n  90Soft Fullstack Project Creator\n');

  // ── Step 1: Gather info ──────────────────────────────────

  const projectName = await ask('Project name', 'my-app');

  // Check if folder already exists
  const projectDir = path.join(process.cwd(), projectName);
  if (fs.existsSync(projectDir)) {
    console.error(`\n  Error: Folder "${projectName}" already exists in this directory.\n`);
    rl.close();
    process.exit(1);
  }

  const displayName = await ask('Display name', projectName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
  const dbName = await ask('Database name', projectName.replace(/-/g, '_'));
  const gitUrl = await ask('GitLab repo URL (Enter to skip)', '');
  const keepExample = await ask('Keep Employee example entity? (y/n)', 'y');
  const adminUser = await ask('Admin username', 'admin');
  const adminEmail = await ask('Admin email', 'admin@example.com');
  const adminPass = await ask('Admin password', 'admin123');

  rl.close();

  // ── Step 2: Clone template ───────────────────────────────

  console.log(`\n  Cloning template into ${projectName}/...\n`);

  try {
    execSync(`git clone --depth 1 ${TEMPLATE_REPO} ${projectName}`, {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
  } catch (e) {
    console.error('\n  Error: Failed to clone template. Check your GitLab access.\n');
    process.exit(1);
  }

  console.log('\n  Configuring project...\n');

  // ── Step 3: Generate keys ────────────────────────────────

  const masterKey = generateKey(32);
  const restApiKey = generateKey(30);
  const jsKey = generateKey(30);
  const appId = projectName
    .replace(/-/g, '_')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\s/g, '');

  // ── Step 4: Create backend .env ──────────────────────────

  const envContent = `appName=${displayName}
appId=${appId}
databaseURI=mongodb://localhost:27017/${dbName}
masterKey=${masterKey}
restAPIKey=${restApiKey}
javascriptKey=${jsKey}
serverURL=http://localhost:1337/api
publicServerURL=http://localhost:1337/api
mountPath=/api

ADMIN_USERNAME=${adminUser}
ADMIN_PASSWORD=${adminPass}
ADMIN_EMAIL=${adminEmail}
`;

  fs.writeFileSync(path.join(projectDir, 'backend', '.env'), envContent, 'utf8');
  console.log('    Created backend/.env');

  // ── Step 4b: Create dashboard.json ───────────────────────

  const dashboardJson = JSON.stringify({
    apps: [{
      serverURL: 'http://localhost:1337/api',
      appId: appId,
      masterKey: masterKey,
      appName: `${displayName} (dev)`,
      production: false,
    }],
  }, null, 2);

  fs.writeFileSync(path.join(projectDir, 'backend', 'dashboard.json'), dashboardJson, 'utf8');
  console.log('    Created backend/dashboard.json');

  // ── Step 5: Update config files ──────────────────────────

  // Root package.json
  replaceInFile(path.join(projectDir, 'package.json'), [
    ['"fullstack-template"', `"${projectName}"`],
  ]);

  // Frontend package.json
  replaceInFile(path.join(projectDir, 'frontend', 'package.json'), [
    ['"angular-template"', `"${projectName}-frontend"`],
  ]);

  // angular.json
  replaceInFile(path.join(projectDir, 'frontend', 'angular.json'), [
    ['angular-template', `${projectName}-frontend`],
  ]);

  // CI/CD
  replaceInFile(path.join(projectDir, '.gitlab-ci.yml'), [
    ['angular-template', `${projectName}-frontend`],
  ]);

  // index.html
  replaceInFile(path.join(projectDir, 'frontend', 'src', 'index.html'), [
    ['<title>My App</title>', `<title>${displayName}</title>`],
  ]);

  // Frontend environments
  const envReplacements = [
    ['parseAppId: \'MyAppId\'', `parseAppId: '${appId}'`],
    ['parseApiKey: \'defaultRestKey456\'', `parseApiKey: '${restApiKey}'`],
    ['parseApiKey: \'CHANGE_ME_REST_API_KEY\'', `parseApiKey: '${restApiKey}'`],
  ];
  replaceInFile(path.join(projectDir, 'frontend', 'src', 'environments', 'environment.ts'), envReplacements);
  replaceInFile(path.join(projectDir, 'frontend', 'src', 'environments', 'environment.prod.ts'), envReplacements);

  // Parse Dashboard config
  replaceInFile(path.join(projectDir, 'backend', 'dashboard.json'), [
    ['MyAppId', appId],
    ['CHANGE_ME_MASTER_KEY', masterKey],
    ['defaultMasterKey123', masterKey],
  ]);

  // PROJECT.md
  replaceInFile(path.join(projectDir, 'PROJECT.md'), [
    ['# Project Document', `# ${displayName}`],
  ]);

  console.log('    Updated all config files');

  // ── Step 6: Remove example entity (optional) ─────────────

  if (keepExample.toLowerCase() !== 'y') {
    // Backend
    removeDir(path.join(projectDir, 'backend', 'src', 'cloudCode', 'models', 'Employee.ts'));
    removeDir(path.join(projectDir, 'backend', 'src', 'cloudCode', 'modules', 'Employee'));

    // Frontend
    removeDir(path.join(projectDir, 'frontend', 'src', 'app', 'models', 'Employee.ts'));
    removeDir(path.join(projectDir, 'frontend', 'src', 'app', 'services', 'dataService', 'employee-service.ts'));
    removeDir(path.join(projectDir, 'frontend', 'src', 'app', 'pages', 'employees'));

    // Clean routes
    const routesPath = path.join(projectDir, 'frontend', 'src', 'app', 'app.routes.ts');
    if (fs.existsSync(routesPath)) {
      let routes = fs.readFileSync(routesPath, 'utf8');
      routes = routes.replace(/\s*\/\/ Employees[^}]*\},\n/gs, '\n');
      fs.writeFileSync(routesPath, routes, 'utf8');
    }

    // Clean nav
    const shellPath = path.join(projectDir, 'frontend', 'src', 'app', 'components', 'layout', 'shell.component.ts');
    if (fs.existsSync(shellPath)) {
      let shell = fs.readFileSync(shellPath, 'utf8');
      shell = shell.replace(/\s*\{[^}]*id: 'employees'[^}]*\},/g, '');
      fs.writeFileSync(shellPath, shell, 'utf8');
    }

    // Clean i18n
    for (const lang of ['en', 'ar']) {
      const i18nPath = path.join(projectDir, 'frontend', 'public', 'i18n', `${lang}.json`);
      if (fs.existsSync(i18nPath)) {
        const json = JSON.parse(fs.readFileSync(i18nPath, 'utf8'));
        delete json.employees;
        if (json.nav) delete json.nav.employees;
        fs.writeFileSync(i18nPath, JSON.stringify(json, null, 2) + '\n', 'utf8');
      }
    }

    console.log('    Removed Employee example entity');
  } else {
    console.log('    Kept Employee example entity');
  }

  // ── Step 7: Git setup ────────────────────────────────────

  removeDir(path.join(projectDir, '.git'));
  execSync('git init', { cwd: projectDir, stdio: 'ignore' });

  if (gitUrl) {
    execSync(`git remote add origin ${gitUrl}`, { cwd: projectDir, stdio: 'ignore' });
    console.log(`    Remote set to ${gitUrl}`);
  }

  // Remove setup.js from the new project (it's standalone)
  const setupFile = path.join(projectDir, 'setup.js');
  if (fs.existsSync(setupFile)) fs.unlinkSync(setupFile);

  console.log('    Initialized fresh git repo');

  // ── Step 8: Install dependencies ─────────────────────────

  console.log('\n  Installing dependencies...\n');

  try {
    execSync('pnpm install', { cwd: path.join(projectDir, 'backend'), stdio: 'inherit' });
  } catch (e) {
    console.log('    Backend install had warnings (usually fine)');
  }

  try {
    execSync('pnpm install --shamefully-hoist', { cwd: path.join(projectDir, 'frontend'), stdio: 'inherit' });
  } catch (e) {
    console.log('    Frontend install had warnings (usually fine)');
  }

  // ── Done ─────────────────────────────────────────────────

  console.log(`
  Setup complete!

  Project:  ${displayName}
  Folder:   ${projectName}/
  App ID:   ${appId}
  Database: ${dbName}
  Admin:    ${adminUser} / ${adminPass}

  Next steps:

    cd ${projectName}
    npm run dev

  Then open http://localhost:4200 and login with ${adminUser} / ${adminPass}
${gitUrl ? `\n    git add -A && git commit -m "Initial setup" && git push -u origin master` : ''}
`);
}

main().catch((err) => {
  console.error('Setup failed:', err);
  rl.close();
  process.exit(1);
});
