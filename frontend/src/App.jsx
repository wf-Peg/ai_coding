import './App.css'
import ClipForm from './components/ClipForm'
import TodoTimeline from './components/TodoTimeline'
import { useState, useEffect } from 'react'

function App() {
  const [pushStatus, setPushStatus] = useState('idle')
  const [pushMessage, setPushMessage] = useState('')
  const [pullStatus, setPullStatus] = useState('idle')
  const [pullMessage, setPullMessage] = useState('')

  const checkPushStatus = async () => {
    try {
      const response = await fetch('http://localhost:8080/api/git/status/push')
      const data = await response.json()
      setPushStatus(data.status)
      setPushMessage(data.message)
    } catch (error) {
      console.error('检查push状态失败:', error)
    }
  }

  const checkPullStatus = async () => {
    try {
      const response = await fetch('http://localhost:8080/api/git/status/pull')
      const data = await response.json()
      setPullStatus(data.status)
      setPullMessage(data.message)
    } catch (error) {
      console.error('检查pull状态失败:', error)
    }
  }

  useEffect(() => {
    let interval
    if (pushStatus === 'running' || pullStatus === 'running') {
      interval = setInterval(() => {
        if (pushStatus === 'running') checkPushStatus()
        if (pullStatus === 'running') checkPullStatus()
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [pushStatus, pullStatus])

  const handlePush = async () => {
    try {
      setPushStatus('running')
      setPushMessage('正在启动...')
      const response = await fetch('http://localhost:8080/api/git/push', {
        method: 'POST'
      })
      if (response.ok) {
        checkPushStatus()
      } else {
        setPushStatus('error')
        setPushMessage('请求失败')
      }
    } catch (error) {
      console.error('Push失败:', error)
      setPushStatus('error')
      setPushMessage('Push失败: ' + error.message)
    }
  }

  const handlePull = async () => {
    try {
      setPullStatus('running')
      setPullMessage('正在启动...')
      const response = await fetch('http://localhost:8080/api/git/pull', {
        method: 'POST'
      })
      if (response.ok) {
        checkPullStatus()
      } else {
        setPullStatus('error')
        setPullMessage('请求失败')
      }
    } catch (error) {
      console.error('Pull失败:', error)
      setPullStatus('error')
      setPullMessage('Pull失败: ' + error.message)
    }
  }

  const getStatusClass = (status) => {
    switch (status) {
      case 'running':
        return 'status-running'
      case 'success':
        return 'status-success'
      case 'error':
        return 'status-error'
      default:
        return 'status-idle'
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>剪藏工具</h1>
        <p>捕捉、整理和管理各类信息，构建个人知识库</p>
      </header>
      
      <main className="app-main">
        <div className="app-layout">
          <aside className="sidebar">
            <TodoTimeline />
          </aside>
          
          <div className="main-content">
            <div className="git-panel">
              <h2>Git 操作</h2>
              <div className="git-buttons">
                <button 
                  className={`git-btn push-btn ${pushStatus === 'running' ? 'disabled' : ''}`}
                  onClick={handlePush}
                  disabled={pushStatus === 'running'}
                >
                  {pushStatus === 'running' ? '推送中...' : 'Git 推送'}
                </button>
                <button 
                  className={`git-btn pull-btn ${pullStatus === 'running' ? 'disabled' : ''}`}
                  onClick={handlePull}
                  disabled={pullStatus === 'running'}
                >
                  {pullStatus === 'running' ? '同步中...' : 'Git 同步'}
                </button>
              </div>
              
              <div className="git-status">
                <div className={`status-item ${getStatusClass(pushStatus)}`}>
                  <span className="status-label">推送状态:</span>
                  <span className="status-text">{pushMessage || '就绪'}</span>
                </div>
                <div className={`status-item ${getStatusClass(pullStatus)}`}>
                  <span className="status-label">同步状态:</span>
                  <span className="status-text">{pullMessage || '就绪'}</span>
                </div>
              </div>
            </div>
            
            <ClipForm />
          </div>
        </div>
      </main>
      
      <footer className="app-footer">
        <p>© 2026 剪藏工具 - 本地存储，安全可靠</p>
      </footer>
    </div>
  )
}

export default App
