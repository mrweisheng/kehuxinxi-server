@echo off
REM === 自动上传 kehuxinxi-backend 到服务器，不包含 node_modules 和 .git ===
REM === 请确保已安装 Git Bash 或 cwRsync，且已配置环境变量 ===

setlocal

REM 设置本地路径和服务器信息
set "LOCAL_DIR=%cd%"
set "REMOTE_USER=root"
set "REMOTE_IP=47.113.177.228"
set "REMOTE_DIR=/root/kehuxinxi-backend"

REM 检查 rsync 是否可用
where rsync >nul 2>nul
if %errorlevel%==0 (
    echo 使用 rsync 增量同步...
    rsync -av --exclude="node_modules" --exclude=".git" "%LOCAL_DIR%/" %REMOTE_USER%@%REMOTE_IP%:%REMOTE_DIR%
) else (
    echo 未检测到 rsync，尝试使用 scp（无法排除 node_modules）...
    scp -r "%LOCAL_DIR%" %REMOTE_USER%@%REMOTE_IP%:%REMOTE_DIR%
)

echo.
echo 上传完成！
pause 