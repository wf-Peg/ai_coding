import './App.css'
import ClipForm from './components/ClipForm'

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>剪藏工具</h1>
        <p>捕捉、整理和管理各类信息，构建个人知识库</p>
      </header>
      
      <main className="app-main">
        <ClipForm />
      </main>
      
      <footer className="app-footer">
        <p>© 2026 剪藏工具 - 本地存储，安全可靠</p>
      </footer>
    </div>
  )
}

export default App
