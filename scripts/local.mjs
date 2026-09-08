// One command for trying GoLinks on a machine without Docker:
//
//   pnpm local
//
// Starts the embedded Postgres, the API (restarting on code changes), and the web app (hot
// reload), waits until the API is ready, and prints sign-in links for an admin and a member.
// Press Enter at any time for fresh links (they expire after four minutes; a browser that
// used one stays signed in for thirty days). Ctrl+C stops everything.

import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const ROOT = new URL('..', import.meta.url).pathname
const API = 'http://localhost:3000'
const WEB = 'http://localhost:5173'
const ADMIN = process.env.LOCAL_ADMIN_EMAIL ?? 'owner@widgets.test'
const MEMBER = process.env.LOCAL_MEMBER_EMAIL ?? 'sam@widgets.test'

const children = []

function run(name, args, color) {
  const child = spawn('pnpm', args, {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `
  const forward = (stream) => {
    let rest = ''
    stream.on('data', (chunk) => {
      rest += chunk.toString()
      const lines = rest.split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) process.stdout.write(prefix + line + '\n')
    })
  }
  forward(child.stdout)
  forward(child.stderr)
  child.on('exit', (code) => {
    if (!stopping) process.stdout.write(`${prefix}exited with code ${code}\n`)
  })
  children.push(child)
  return child
}

/** Every process below `pid`, deepest first, from the process table. */
function descendantsOf(pid) {
  const table = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
  const found = []
  const walk = (parent) => {
    for (const [child, ppid] of table) {
      if (ppid === parent) {
        walk(child)
        found.push(child)
      }
    }
  }
  walk(pid)
  return found
}

function signalTree(signal) {
  // pnpm runs each script through a shell, so the servers are grandchildren; a signal to the
  // whole tree reaches tsx, vite, and postgres whatever process group they ended up in.
  for (const child of children) {
    for (const pid of [...descendantsOf(child.pid), child.pid]) {
      try {
        process.kill(pid, signal)
      } catch {}
    }
  }
}

let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  process.stdout.write('\nStopping...\n')
  signalTree('SIGINT')
  setTimeout(() => {
    signalTree('SIGKILL')
    process.exit(0)
  }, 4000)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

async function ready() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${API}/_/health/ready`)
      if (response.ok) return true
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return false
}

function signInLink(email) {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['--filter', '@golinks/api', '--silent', 'sign-in-link', email], {
      cwd: ROOT,
      env: process.env,
    })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      out += chunk.toString()
    })
    child.on('exit', () => resolve(out.trim().split('\n').pop() ?? ''))
  })
}

async function printLinks() {
  process.stdout.write('\n\x1b[1mSign in (open in a browser; valid four minutes)\x1b[0m\n')
  process.stdout.write(`  admin  ${ADMIN}\n    ${await signInLink(ADMIN)}\n`)
  process.stdout.write(`  member ${MEMBER}\n    ${await signInLink(MEMBER)}\n`)
  process.stdout.write(`\n  app: ${WEB}    go links: ${API}/<keyword>    api: ${API}/_/api/v1/me\n`)
  process.stdout.write('  Press Enter for fresh links, Ctrl+C to stop.\n\n')
}

run('db', ['--filter', '@golinks/api', 'dev:db'], '35')
run('api', ['--filter', '@golinks/api', 'dev'], '34')
run('web', ['--filter', '@golinks/web', 'dev'], '32')

if (!(await ready())) {
  process.stdout.write('The API did not become ready; see the [api] and [db] lines above.\n')
  stop()
} else {
  await printLinks()
  createInterface({ input: process.stdin }).on('line', () => {
    void printLinks()
  })
}
