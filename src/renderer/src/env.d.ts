/// <reference types="vite/client" />

import type { LocalCoderApi } from '../../shared/api'

declare global {
  interface Window {
    localCoder: LocalCoderApi
  }
}

export {}
