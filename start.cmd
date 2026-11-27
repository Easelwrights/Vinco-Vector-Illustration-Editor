@echo off
cd /d "%~dp0"
where docker >nul 2>nul || (echo Instale o Docker Desktop e rode de novo: https://docs.docker.com/desktop/ & echo Sem Docker, rode so o editor com: npm run serve & pause & exit /b 1)
if not exist .env powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-env.ps1"
docker compose up -d --build || (pause & exit /b 1)
echo.
echo Aguardando o Vinco subir...
powershell -NoProfile -Command "$port=(Select-String -Path .env -Pattern '^VINCO_PORT=(.*)').Matches.Groups[1].Value; if(-not $port){$port=8080}; for($i=0;$i -lt 90;$i++){ try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ('http://localhost:'+$port+'/api/v1/health') | Out-Null; Start-Process ('http://localhost:'+$port); exit 0 } catch { Start-Sleep 2 } }; exit 1"
if errorlevel 1 (echo O Vinco ainda esta subindo. Acompanhe com: docker compose logs -f web) else (echo Pronto! O Vinco abriu no navegador.)
pause
