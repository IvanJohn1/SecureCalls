@echo off
echo =======================================================
echo   SecureCall - Windows Build System
echo =======================================================

echo [1/5] Installing npm dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed!
    pause
    exit /b 1
)

echo [2/5] Checking Windows project...
if not exist "windows\SecureCallApp.sln" (
    call npx react-native init-windows --overwrite
)

echo [3/5] Running autolinking from project root...
:: IMPORTANT: Must run from project root so react-native.config.js is found.
:: MSBuild's AutolinkCheck target runs from windows\ (the .sln directory), where
:: react-native.config.js does not exist, causing config.project.windows to be null
:: and throwing NoWindowsConfig. We run autolinking here manually instead, and pass
:: /p:RunAutolinkCheck=false to MSBuild to skip the broken in-build check.
call npx --yes @react-native-community/cli autolink-windows --sln windows\SecureCallApp.sln --proj windows\SecureCallApp\SecureCallApp.csproj
if errorlevel 1 (
    echo WARNING: autolink-windows step had issues. Continuing...
)

echo [4/5] Restoring NuGet packages...
msbuild windows\SecureCallApp.sln /t:Restore /p:RestorePackagesConfig=true /p:Configuration=Release /p:Platform=x64
if errorlevel 1 (
    echo ERROR: NuGet restore failed!
    pause
    exit /b 1
)

echo [5/5] Building (JS bundle + native compilation)...
:: MSBuild handles JS bundling internally (uses index.windows.js automatically).
:: RunAutolinkCheck=false: skip the in-build check since we ran autolink in step 3
:: from the project root where react-native.config.js is correctly found.
msbuild windows\SecureCallApp.sln /p:Configuration=Release /p:Platform=x64 /p:AppxBundle=Never /p:RunAutolinkCheck=false /maxcpucount
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
