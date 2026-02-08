/**
 * Application Entry Point
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

// Global error handler
window.onerror = (message, source, lineno, colno, error) => {
  console.error('Global error:', message, source, lineno, colno, error)
  const root = document.getElementById('root')
  if (root) {
    root.textContent = ''
    const container = document.createElement('div')
    container.style.cssText = 'padding: 20px; font-family: sans-serif;'
    const heading = document.createElement('h2')
    heading.style.color = 'red'
    heading.textContent = 'Application Error'
    container.appendChild(heading)
    const msgP = document.createElement('p')
    msgP.textContent = String(message)
    container.appendChild(msgP)
    const srcP = document.createElement('p')
    srcP.style.cssText = 'font-size: 12px; color: gray;'
    srcP.textContent = `${source}:${lineno}:${colno}`
    container.appendChild(srcP)
    root.appendChild(container)
  }
}

window.onunhandledrejection = (event) => {
  console.error('Unhandled promise rejection:', event.reason)
}

try {
  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('Root element not found')
  }
  
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
} catch (err) {
  console.error('Failed to render app:', err)
  const root = document.getElementById('root')
  if (root) {
    root.textContent = ''
    const container = document.createElement('div')
    container.style.cssText = 'padding: 20px; font-family: sans-serif;'
    const heading = document.createElement('h2')
    heading.style.color = 'red'
    heading.textContent = 'Failed to Start'
    container.appendChild(heading)
    const msgP = document.createElement('p')
    msgP.textContent = err instanceof Error ? err.message : String(err)
    container.appendChild(msgP)
    root.appendChild(container)
  }
}
