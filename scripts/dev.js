import { spawn } from 'node:child_process'

const run = (args) =>
  spawn(process.execPath, args, { stdio: 'inherit' })

// Local-only Worker with isolated local D1/R2 state; never touches production resources.
const children = [
  run([
    'node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'wrangler.admin-test.toml', '--local',
    '--ip', '127.0.0.1', '--port', '8788', '--persist-to', 'migration/.admin-test-state',
  ]),
  run(['node_modules/vite/bin/vite.js', ...process.argv.slice(2)]),
]

const stop = (code = 0) => {
  children.forEach((child) => child.kill())
  process.exit(code)
}
children.forEach((child) => child.on('exit', (code) => stop(code ?? 0)))
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
