import { spawn, type ChildProcess } from 'node:child_process'

interface FrozenRegistryReady {
  readonly status: 'ready'
  readonly port: number
}

interface FrozenRegistryUnavailable {
  readonly status: 'unavailable'
  readonly code: string
  readonly message: string
}

type FrozenRegistryStartMessage =
  | FrozenRegistryReady
  | FrozenRegistryUnavailable

export interface FrozenRegistryProcess {
  readonly child: ChildProcess
  readonly registry?: string
  readonly unavailableReason?: string
}

function startupMessage(line: string): FrozenRegistryStartMessage {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new Error(`local frozen registry emitted invalid startup JSON: ${JSON.stringify(line)}`)
  }
  if (value === null || typeof value !== 'object') {
    throw new Error('local frozen registry emitted a non-object startup message')
  }
  const message = value as Record<string, unknown>
  if (message.status === 'ready'
    && Number.isSafeInteger(message.port)
    && Number(message.port) > 0
    && Number(message.port) <= 65_535) {
    return Object.freeze({ status: 'ready', port: Number(message.port) })
  }
  if (message.status === 'unavailable'
    && typeof message.code === 'string'
    && typeof message.message === 'string') {
    return Object.freeze({
      status: 'unavailable',
      code: message.code,
      message: message.message,
    })
  }
  throw new Error('local frozen registry emitted an unknown startup message')
}

async function waitForStartup(child: ChildProcess): Promise<FrozenRegistryStartMessage> {
  return await new Promise((resolve, reject) => {
    let stdout = ''
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('local frozen registry did not start'))
    }, 10_000)
    const cleanup = (): void => {
      clearTimeout(timeout)
      child.stdout?.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const onData = (chunk: Buffer): void => {
      stdout += String(chunk)
      const newline = stdout.indexOf('\n')
      if (newline < 0) return
      cleanup()
      try {
        resolve(startupMessage(stdout.slice(0, newline)))
      } catch (error) {
        reject(error)
      }
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup()
      reject(new Error(
        `local frozen registry exited before startup (status=${String(code)}, signal=${String(signal)})`,
      ))
    }
    child.stdout?.on('data', onData)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

export async function startFrozenRegistry(
  script: string,
  args: readonly string[],
): Promise<FrozenRegistryProcess> {
  const child = spawn(process.execPath, [script, ...args], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  try {
    const message = await waitForStartup(child)
    if (message.status === 'ready') {
      return Object.freeze({
        child,
        registry: `http://127.0.0.1:${message.port}/`,
      })
    }
    if (message.code === 'EPERM' || message.code === 'EACCES') {
      return Object.freeze({
        child,
        unavailableReason:
          `local frozen registry unavailable: loopback bind ${message.code}`,
      })
    }
    throw new Error(
      `local frozen registry failed to bind (${message.code}): ${message.message}`,
    )
  } catch (error) {
    child.kill('SIGTERM')
    throw error
  }
}

export async function stopFrozenRegistry(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('local frozen registry did not stop after SIGTERM'))
    }, 2_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}
