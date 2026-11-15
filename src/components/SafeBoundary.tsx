'use client'
// Barreira de erro: se o componente dentro dela quebrar, só ele some (ou mostra `fallback`)
// e o resto do app — principalmente a navegação — continua funcionando.
import { Component, ReactNode } from 'react'

interface Props {
  name: string
  children: ReactNode
  fallback?: ReactNode | ((reset: () => void) => ReactNode)
}
interface State { failed: boolean }

export default class SafeBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(`[SafeBoundary:${this.props.name}]`, error)
  }

  reset = () => this.setState({ failed: false })

  render() {
    if (!this.state.failed) return this.props.children
    const fb = this.props.fallback
    return typeof fb === 'function' ? fb(this.reset) : (fb ?? null)
  }
}
