import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/nimiq.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Steakout root element is missing')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
