@echo off
echo =======================================================
echo   SecureCall - Windows Build System
echo =======================================================

echo [1/4] Installing npm dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed!
    pause
    exit /b 1
)

echo [2/4] Checking Windows project...
if not exist "windows\SecureCallApp.sln" (
    call npx react-native init-windows --overwrite
)

echo [3/4] Restoring NuGet packages...
msbuild windows\SecureCallApp.sln /t:Restore /p:RestorePackagesConfig=true /p:Configuration=Release /p:Platform=x64
if errorlevel 1 (
    echo ERROR: NuGet restore failed!
    pause
    exit /b 1
)

echo [4/4] Building (JS bundle + native compilation)...
:: MSBuild handles JS bundling internally (uses index.windows.js automatically).
:: This avoids the 'NoWindowsConfig' error from react-native run-windows CLI.
msbuild windows\SecureCallApp.sln /p:Configuration=Release /p:Platform=x64 /p:AppxBundle=Never /maxcpucount
if errorlevel 1 (
    echo ERROR: Build failed! Check output above.
    pause
    exit /b 1
)

echo =======================================================
echo   Build complete!
echo   App: windows\x64\Release\SecureCallApp\SecureCallApp.exe
echo =======================================================
pause
