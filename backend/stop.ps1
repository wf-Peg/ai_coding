$port=8080; Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | % { Stop-Process -Id $_.OwningProcess -Force }
