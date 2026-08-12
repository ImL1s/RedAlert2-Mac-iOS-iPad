import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const rootDir = join(__dirname, '..');
console.log('=== [M1 ITERATION 2 EMPIRICAL CHALLENGE SUITE] ===');
console.log(`Root directory: ${rootDir}`);

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, failureDetail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✓ PASS: ${testName}`);
  } else {
    failedTests++;
    console.error(`✗ FAIL: ${testName}`);
    if (failureDetail) {
      console.error(`  Detail: ${failureDetail}`);
    }
  }
}

// ==========================================
// 1. Gradle Product Flavors Verification
// ==========================================
console.log('\n--- 1. Gradle Product Flavors Verification (android/app/build.gradle.kts) ---');

const gradleKtsPath = join(rootDir, 'android', 'app', 'build.gradle.kts');
assert(existsSync(gradleKtsPath), 'android/app/build.gradle.kts exists');

if (existsSync(gradleKtsPath)) {
  const gradleContent = readFileSync(gradleKtsPath, 'utf-8');

  assert(
    gradleContent.includes('flavorDimensions += "distribution"') || gradleContent.includes('flavorDimensions += listOf("distribution")'),
    'flavorDimensions includes "distribution"'
  );

  assert(
    gradleContent.includes('productFlavors {') && gradleContent.includes('create("publicCi")') && gradleContent.includes('create("privateSmoke")'),
    'productFlavors block defines both publicCi and privateSmoke'
  );

  assert(
    gradleContent.includes('create("publicCi")'),
    'publicCi product flavor registered'
  );

  assert(
    gradleContent.includes('create("privateSmoke")') && gradleContent.includes('applicationIdSuffix = ".privatesmoke"'),
    'privateSmoke product flavor registered with applicationIdSuffix = ".privatesmoke"'
  );

  assert(
    gradleContent.includes('dimension = "distribution"'),
    'Flavors bound to "distribution" dimension'
  );

  assert(
    gradleContent.includes('applicationId = "com.ammaar.ra2web"'),
    'Base applicationId configured as "com.ammaar.ra2web"'
  );
}

// ==========================================
// 2. Asset Quarantine & .gitignore Verification
// ==========================================
console.log('\n--- 2. Asset Quarantine & .gitignore Verification ---');

const gitignorePath = join(rootDir, '.gitignore');
assert(existsSync(gitignorePath), '.gitignore exists');

if (existsSync(gitignorePath)) {
  const gitignoreContent = readFileSync(gitignorePath, 'utf-8');

  const requiredPatterns = [
    'private-probe-assets/',
    'private-smoke-assets/',
    'android/app/src/privateSmoke/assets/',
    'android/app/src/privateSmoke/res/',
    '*.apk',
    'gameres-export/',
    'ios/Resources/GameRes/',
    'ios/Resources/WebDist/',
    'redalert2/public/local-pack/',
    'redalert2/public/general.csf',
    'redalert2/public/generalmd.csf',
    'redalert2/public/general.zh-CN.csf',
    'redalert2/public/ini.mix',
    'android/.gradle/',
    'android/app/build/',
    'android/build/'
  ];

  for (const pattern of requiredPatterns) {
    assert(
      gitignoreContent.includes(pattern),
      `.gitignore contains quarantined pattern: ${pattern}`
    );
  }
}

// ==========================================
// 3. Empirical Git Ignored Behavior Probe
// ==========================================
console.log('\n--- 3. Empirical Git Ignored Behavior Probe ---');

const testFilePaths = [
  join(rootDir, 'private-probe-assets', 'test-probe.mix'),
  join(rootDir, 'private-smoke-assets', 'test-smoke.mix'),
  join(rootDir, 'android', 'app', 'src', 'privateSmoke', 'assets', 'test-flavor-asset.mix'),
  join(rootDir, 'android', 'app', 'src', 'privateSmoke', 'res', 'raw', 'test-res.bin'),
  join(rootDir, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
  join(rootDir, 'gameres-export', 'ra2.mix'),
  join(rootDir, 'ios', 'Resources', 'GameRes', 'ra2.mix'),
  join(rootDir, 'ios', 'Resources', 'WebDist', 'index.html'),
  join(rootDir, 'redalert2', 'public', 'local-pack', 'pack.zip'),
  join(rootDir, 'redalert2', 'public', 'general.csf'),
  join(rootDir, 'redalert2', 'public', 'generalmd.csf'),
  join(rootDir, 'redalert2', 'public', 'ini.mix')
];

for (const testPath of testFilePaths) {
  try {
    const parentDir = join(testPath, '..');
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    const createdDummy = !existsSync(testPath);
    if (createdDummy) {
      writeFileSync(testPath, 'DUMMY ASSET PROBE TEST');
    }

    let isIgnored = false;
    try {
      const output = execSync(`git check-ignore "${testPath}"`, { cwd: rootDir, encoding: 'utf-8' });
      isIgnored = output.trim().length > 0;
    } catch (e) {
      isIgnored = false;
    }

    assert(
      isIgnored,
      `Git ignores quarantined path: ${testPath.slice(rootDir.length + 1)}`
    );

    if (createdDummy && existsSync(testPath)) {
      rmSync(testPath, { force: true });
    }
  } catch (err: any) {
    assert(false, `Error testing ignore for ${testPath}: ${err.message}`);
  }
}

// ==========================================
// 4. Check for Unquarantined Staged Build Output Gaps
// ==========================================
console.log('\n--- 4. Checking Unquarantined Staged Build Output Gaps ---');

const androidWebDistPath = join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'WebDist', 'test-probe.html');
try {
  const webDistParent = join(androidWebDistPath, '..');
  if (!existsSync(webDistParent)) {
    mkdirSync(webDistParent, { recursive: true });
  }
  const createdDummy = !existsSync(androidWebDistPath);
  if (createdDummy) {
    writeFileSync(androidWebDistPath, 'DUMMY STAGED WEBDIST PROBE');
  }

  let isIgnored = false;
  try {
    const output = execSync(`git check-ignore "${androidWebDistPath}"`, { cwd: rootDir, encoding: 'utf-8' });
    isIgnored = output.trim().length > 0;
  } catch (e) {
    isIgnored = false;
  }

  assert(
    isIgnored,
    `Staged Android WebDist assets path (android/app/src/main/assets/WebDist/) is quarantined in .gitignore`,
    `android/app/src/main/assets/WebDist/ is NOT in .gitignore, leaving 7.9MB of staged build outputs untracked and risk of accidental git commit!`
  );

  if (createdDummy && existsSync(androidWebDistPath)) {
    rmSync(androidWebDistPath, { force: true });
  }
} catch (err: any) {
  assert(false, `Error probing android WebDist ignore: ${err.message}`);
}

// ==========================================
// 5. Scan Git Index for Tracked Forbidden Assets
// ==========================================
console.log('\n--- 5. Scanning Git Index for Tracked Forbidden/Retail Assets ---');

try {
  const trackedFiles = execSync('git ls-files', { cwd: rootDir, encoding: 'utf-8' }).split(/\r?\n/);
  const forbiddenPatterns = [
    /\.mix$/i,
    /\.csf$/i,
    /\.apk$/i,
    /private-probe-assets/i,
    /private-smoke-assets/i,
    /privateSmoke\/assets/i,
    /ios\/Resources\/GameRes/i,
    /ios\/Resources\/WebDist/i,
    /android\/app\/src\/main\/assets\/WebDist/i
  ];

  let leakedFiles: string[] = [];
  for (const file of trackedFiles) {
    if (!file) continue;
    for (const pat of forbiddenPatterns) {
      if (pat.test(file)) {
        leakedFiles.push(file);
      }
    }
  }

  assert(
    leakedFiles.length === 0,
    'Zero forbidden/retail assets or staged build outputs are currently tracked in Git index',
    `Found tracked files: ${leakedFiles.join(', ')}`
  );
} catch (err: any) {
  assert(false, `Error scanning git index: ${err.message}`);
}

// ==========================================
// Final Summary
// ==========================================
console.log('\n==========================================');
console.log(`TEST RESULTS: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
console.log('==========================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
