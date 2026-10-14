import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runProcess } from "../../app/process.ts";

const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";

async function installation(scenario: string, noPath = false) {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "bishop-installer-")));
  const root = join(temporary, "Bishop with spaces");
  await mkdir(root);
  const log = join(temporary, "calls.txt");
  await writeFile(log, "");
  const files = ["package.json", "package-lock.json", "app/cli.ts", "app/providers/codex-path.ts",
    "app/providers/codex-login.ts", "config/bishop.toml", "bishop.cmd", "start.ps1"];
  for (const file of files) {
    const target = join(root, file);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, "existing content\n");
  }
  await copyFile("install.ps1", join(root, "install.ps1"));
  await writeFile(join(root, "install-command.ps1"), "Add-Content -LiteralPath $env:BISHOP_INSTALL_TEST_LOG -Value 'register'\n");
  const harness = `
function Get-Command {
    param($Name, $CommandType, $ErrorAction)
    if ($Name -eq 'node.exe' -and $env:BISHOP_INSTALL_TEST_SCENARIO -ne 'missing-node') { return [pscustomobject]@{ Source = 'Invoke-TestNode' } }
    if ($Name -eq 'npm.cmd' -and $env:BISHOP_INSTALL_TEST_SCENARIO -ne 'missing-npm') { return [pscustomobject]@{ Source = 'Invoke-TestNpm' } }
    return $null
}
function Invoke-TestNode {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq '--version') {
        if ($env:BISHOP_INSTALL_TEST_SCENARIO -eq 'old-node') { return 'v22.0.0' }
        if ($env:BISHOP_INSTALL_TEST_SCENARIO -eq 'invalid-version') { return 'unknown' }
        return 'v24.0.0'
    }
    if ($args[0] -ne '--input-type=module' -or $args[1] -ne '--eval' -or $args[2] -notmatch 'requireChatGPTLogin') { throw 'Unexpected model command' }
    if ((Get-Location).Path -ne $env:BISHOP_INSTALL_TEST_ROOT) { throw 'Wrong login working directory' }
    Add-Content -LiteralPath $env:BISHOP_INSTALL_TEST_LOG -Value 'login'
    if ($env:BISHOP_INSTALL_TEST_SCENARIO -eq 'login-failure') { $global:LASTEXITCODE = 1 }
}
function Invoke-TestNpm {
    if (($args -join ' ') -ne 'ci --omit=dev --no-audit --no-fund') { throw 'Unexpected npm arguments' }
    if ((Get-Location).Path -ne $env:BISHOP_INSTALL_TEST_ROOT) { throw 'Wrong npm working directory' }
    Add-Content -LiteralPath $env:BISHOP_INSTALL_TEST_LOG -Value 'npm'
    $global:LASTEXITCODE = 0
    if ($env:BISHOP_INSTALL_TEST_SCENARIO -eq 'npm-failure') { $global:LASTEXITCODE = 1 }
}
. ${quote(join(root, "install.ps1"))}${noPath ? " -NoPath" : ""}
`;
  try {
    const result = await runProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", harness], {
      cwd: temporary, env: { ...process.env, BISHOP_INSTALL_TEST_SCENARIO: scenario,
        BISHOP_INSTALL_TEST_LOG: log, BISHOP_INSTALL_TEST_ROOT: root },
    });
    // Installing must never replace the user's configuration, including on failures.
    assert.equal(await readFile(join(root, "config/bishop.toml"), "utf8"), "existing content\n");
    const calls = (await readFile(log, "utf8")).trim().split(/\r?\n/).filter(Boolean);
    return { ...result, calls };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

test("Windows installer installs from paths with spaces, registers after success, and preserves config", { skip: process.platform !== "win32" }, async () => {
  const result = await installation("success");
  assert.equal(result.exitCode, 0, result.stderr + result.stdout);
  assert.deepEqual(result.calls, ["login", "npm", "register"]);
  assert.match(result.stdout, /Bishop installation complete/);
  const noPath = await installation("success", true);
  assert.equal(noPath.exitCode, 0, noPath.stderr + noPath.stdout);
  assert.deepEqual(noPath.calls, ["login", "npm"]);
  assert.match(noPath.stdout, /bishop.cmd chat/);
});

test("Windows installer stops on missing/old prerequisites before npm or registration", { skip: process.platform !== "win32" }, async () => {
  for (const scenario of ["missing-node", "old-node", "invalid-version", "missing-npm"]) {
    const result = await installation(scenario);
    assert.equal(result.exitCode, 1, result.stderr + result.stdout);
    assert.deepEqual(result.calls, []);
    assert.match(result.stdout, /Node.js|npm/);
    assert.doesNotMatch(result.stdout, /installation complete/);
  }
  const login = await installation("login-failure");
  assert.equal(login.exitCode, 1);
  assert.deepEqual(login.calls, ["login"]);
  assert.match(login.stdout, /Codex prerequisite check failed/);
});

test("Windows installer npm failures never register the command or report completion", { skip: process.platform !== "win32" }, async () => {
  const result = await installation("npm-failure");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.calls, ["login", "npm"]);
  assert.match(result.stdout, /Dependency installation failed/);
  assert.doesNotMatch(result.stdout, /installation complete/);
});
