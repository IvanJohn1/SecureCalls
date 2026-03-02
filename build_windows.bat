@echo off
echo =======================================================
echo   SecureCall - Windows Build System
echo =======================================================

echo [1/6] Installing npm dependencies...
call npm install

echo [2/6] Checking Windows project...
if not exist "windows\SecureCallApp.sln" (
    call npx react-native init-windows --overwrite
)

echo [3/6] Restoring NuGet packages...
msbuild windows\SecureCallApp.sln -t:Restore -p:RestorePackagesConfig=true -p:Configuration=Release -p:Platform=x64

echo [4/6] Cleaning old JS bundle...
if exist "windows\SecureCallApp\Bundle" (
    del /q "windows\SecureCallApp\Bundle\*.*" 2>nul
)
if not exist "windows\SecureCallApp\Bundle" mkdir "windows\SecureCallApp\Bundle"

echo [5/6] Bundling JS (platform=windows, entry=index.windows.js, reset-cache)...
call npx react-native bundle --platform windows --dev false --entry-file index.windows.js --bundle-output windows\SecureCallApp\Bundle\index.windows.bundle --assets-dest windows\SecureCallApp\Bundle --reset-cache
if errorlevel 1 (
    echo ERROR: JS bundling failed!
    pause
    exit /b 1
)

echo [6/6] Building Native App (release, x64)...
call npx react-native run-windows --release --arch x64 --no-launch --no-packager --logging

echo =======================================================
echo   Build complete!
echo =======================================================
pause
