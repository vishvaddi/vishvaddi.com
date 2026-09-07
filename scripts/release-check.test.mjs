import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const run = (steps) => spawnSync(process.execPath, ['--input-type=module', '-e',
  `import { runSteps } from './scripts/release-check.mjs'; process.exitCode = runSteps(${JSON.stringify(steps)})`,
], { encoding: 'utf8' })
const step = (code) => [process.execPath, '-e', code]

test('a failed harness retains its exit code and prevents the next step', () => {
  const result = run([step('console.log("harness failed"); process.exit(7)'), step('console.log("SHOULD_NOT_RUN")')])
  assert.equal(result.status, 7)
  assert.match(result.stdout, /harness failed/)
  assert.doesNotMatch(result.stdout, /SHOULD_NOT_RUN/)
})

test('a command that cannot start prevents the next step', () => {
  const result = run([['./nonexistent-release-command'], step('console.log("SHOULD_NOT_RUN")')])
  assert.equal(result.status, 1)
  assert.doesNotMatch(result.stdout, /SHOULD_NOT_RUN/)
})

test('successful steps run in order', () => {
  const result = run([step('console.log("first")'), step('console.log("second")')])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /first\r?\nsecond/)
})
