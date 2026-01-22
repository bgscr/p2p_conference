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
    root.innerHTML = `
      <div style="padding: 20px; font-family: sans-serif;">
        <h2 style="color: red;">Application Error</h2>
        <p>${message}</p>
        <p style="font-size: 12px; color: gray;">${source}:${lineno}:${colno}</p>
      </div>
    `
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
    root.innerHTML = `
      <div style="padding: 20px; font-family: sans-serif;">
        <h2 style="color: red;">Failed to Start</h2>
        <p>${err instanceof Error ? err.message : String(err)}</p>
      </div>
    `
  }
}
