@echo off
echo =======================================================
echo   SecureCall - Windows Build System
echo =======================================================

echo [1/6] Installing npm dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed!
    pause
    exit /b 1
)

echo [2/6] Checking Windows project...
:: init-windows creates windows\SecureCallApp.sln, windows\SecureCallApp\SecureCallApp.csproj
:: and all the native C# files needed for the Windows build.
:: Template old/uwp-cs-app matches our react-native.config.js (C# UWP project).
if not exist "windows\SecureCallApp\SecureCallApp.csproj" (
    echo        Windows project not found. Initializing...
    call npx react-native init-windows --template old/uwp-cs-app --overwrite
    if errorlevel 1 (
        echo ERROR: init-windows failed!
        pause
        exit /b 1
    )
)

echo [3/6] Running autolinking from project root...
:: IMPORTANT: Must run from project root so react-native.config.js is found.
:: MSBuild's AutolinkCheck target runs from windows\ (the .sln directory), where
:: react-native.config.js does not exist, causing config.project.windows to be null
:: and throwing NoWindowsConfig. We run autolinking here manually instead, and pass
:: /p:RunAutolinkCheck=false to MSBuild to skip the broken in-build check.
call npx react-native autolink-windows --sln windows\SecureCallApp.sln --proj windows\SecureCallApp\SecureCallApp.csproj
if errorlevel 1 (
    echo WARNING: autolink-windows step had issues. Continuing...
)

echo [4/6] Bundling JavaScript...
:: Pre-bundle JS so MSBuild does not need to invoke Metro.
:: Uses index.windows.js which has explicit .windows imports.
if not exist "windows\SecureCallApp\Bundle" mkdir "windows\SecureCallApp\Bundle"
call npx react-native bundle --platform windows --dev false --entry-file index.windows.js --bundle-output windows\SecureCallApp\Bundle\index.windows.bundle --assets-dest windows\SecureCallApp\Bundle
if errorlevel 1 (
    echo ERROR: JS bundling failed!
    pause
    exit /b 1
)

echo [5/6] Restoring NuGet packages...
msbuild windows\SecureCallApp.sln /t:Restore /p:RestorePackagesConfig=true /p:Configuration=Release /p:Platform=x64
if errorlevel 1 (
    echo WARNING: NuGet restore had issues. Trying build anyway...
)

echo [6/6] Building native app...
:: RunAutolinkCheck=false: skip the in-build check (we ran autolink in step 3).
:: BundleEntryFile / BundleRootDir: tell MSBuild to use our pre-bundled JS.
msbuild windows\SecureCallApp.sln /p:Configuration=Release /p:Platform=x64 /p:AppxBundle=Never /p:RunAutolinkCheck=false /p:BundleEntryFile=index.windows.js /maxcpucount
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
