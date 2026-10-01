import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createTheme, ThemeProvider } from '@mui/material'
import './index.css'
import App from './App.tsx'

// Follow the OS light/dark preference and use the --accent colors from index.css.
// Light mode uses a slightly deeper purple so white button text meets WCAG AA (5.1:1).
const theme = createTheme({
  colorSchemes: {
    light: { palette: { primary: { main: '#9d2ff0' } } },
    dark: { palette: { primary: { main: '#c084fc' } } },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
