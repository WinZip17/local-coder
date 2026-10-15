declare module 'fetch-socks' {
  import type { Dispatcher } from 'undici'

  export function socksDispatcher(options: {
    type: 4 | 5
    host: string
    port: number
    userId?: string
    password?: string
  }): Dispatcher
}
