import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export function runSteps(steps, options = {}) {
  for (const [command, ...args] of steps) {
    const result = spawnSync(command, args, { stdio: 'inherit', ...options, shell: false })
    if (result.error || result.signal || result.status !== 0) {
      console.error(`Release check stopped: ${command} ${args.join(' ')} (${result.error?.message ?? result.signal ?? result.status})`)
      return result.status || 1
    }
  }
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const npm = process.env.npm_execpath
  if (!npm) {
    console.error('Run with npm run release:check')
    process.exitCode = 1
  } else {
    process.exitCode = runSteps([
      [process.execPath, '--test', 'scripts/release-check.test.mjs'],
      [process.execPath, npm, 'run', 'check'],
      [process.execPath, npm, 'run', 'build'],
      [process.execPath, 'scripts/feature-upgrades-e2e.mjs', 'dist'],
      [process.execPath, 'scripts/audio-tools-e2e.mjs', 'dist'],
      [process.execPath, 'scripts/studio-e2e.mjs', 'dist'],
    ], { cwd: fileURLToPath(new URL('../', import.meta.url)) })
  }
}
