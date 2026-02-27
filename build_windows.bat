@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

echo ═══════════════════════════════════════════════════════
echo   SecureCall — Windows 10/11 Desktop Build
echo ═══════════════════════════════════════════════════════
echo.

:: ═══════════════════════════════════════════════════════════
:: ПРОВЕРКА PREREQUISITES
:: ═══════════════════════════════════════════════════════════

echo [1/8] Проверка Node.js...
node --version > nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ Node.js не найден. Установите Node.js 18+
    echo    https://nodejs.org/
    pause
    exit /b 1
)

echo [2/8] Проверка Visual Studio...
where MSBuild.exe > nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ⚠️  MSBuild не найден в PATH.
    echo    Убедитесь что установлена Visual Studio 2022 с:
    echo    - Desktop development with C++
    echo    - Universal Windows Platform development
    echo    - Windows 10/11 SDK (10.0.19041.0 или новее)
    echo.
    echo    Запустите билд из "Developer Command Prompt for VS 2022"
    echo    или "x64 Native Tools Command Prompt for VS 2022"
    echo.
    echo    Продолжаем установку зависимостей...
)

:: ═══════════════════════════════════════════════════════════
:: УСТАНОВКА ЗАВИСИМОСТЕЙ
:: ═══════════════════════════════════════════════════════════

echo [3/8] Установка npm зависимостей...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ❌ npm install failed
    pause
    exit /b %ERRORLEVEL%
)

:: Установка react-native-windows если нет
if not exist "node_modules\react-native-windows" (
    echo [3.5/8] Установка react-native-windows...
    call npm install react-native-windows@^0.77.0
    if %ERRORLEVEL% neq 0 (
        echo ❌ react-native-windows install failed
        pause
        exit /b %ERRORLEVEL%
    )
)

:: Установка react-native-image-picker если нет
if not exist "node_modules\react-native-image-picker" (
    echo [3.6/8] Установка react-native-image-picker...
    call npm install react-native-image-picker@^7.0.0
    if %ERRORLEVEL% neq 0 (
        echo ⚠️ react-native-image-picker install failed (не критично)
    )
)

:: ═══════════════════════════════════════════════════════════
:: ИНИЦИАЛИЗАЦИЯ WINDOWS ПРОЕКТА (если нет)
:: ═══════════════════════════════════════════════════════════

if not exist "windows" (
    echo [4/8] Инициализация Windows проекта...
    call npx react-native-windows-init --overwrite --language cs
    if %ERRORLEVEL% neq 0 (
        echo ❌ react-native-windows-init failed
        echo    Убедитесь что Visual Studio 2022 установлена
        pause
        exit /b %ERRORLEVEL%
    )
) else (
    echo [4/8] Windows проект уже инициализирован
)

:: ═══════════════════════════════════════════════════════════
:: ОЧИСТКА КЭШЕЙ
:: ═══════════════════════════════════════════════════════════

echo [5/8] Очистка кэшей Metro и React...
powershell -Command "Remove-Item -Recurse -Force $env:TEMP\metro-* -ErrorAction Ignore"
powershell -Command "Remove-Item -Recurse -Force $env:TEMP\react-* -ErrorAction Ignore"

:: ═══════════════════════════════════════════════════════════
:: ГЕНЕРАЦИЯ JS BUNDLE
:: ═══════════════════════════════════════════════════════════

echo [6/8] Генерация JS Bundle для Windows...
if not exist "windows\Bundle" mkdir "windows\Bundle"
call npx react-native bundle ^
    --platform windows ^
    --dev false ^
    --entry-file index.js ^
    --bundle-output windows\Bundle\index.windows.bundle ^
    --assets-dest windows\Bundle
if %ERRORLEVEL% neq 0 (
    echo ❌ Ошибка генерации JS bundle
    pause
    exit /b %ERRORLEVEL%
)

:: ═══════════════════════════════════════════════════════════
:: СБОРКА WINDOWS ПРИЛОЖЕНИЯ
:: ═══════════════════════════════════════════════════════════

echo [7/8] Сборка Windows Release...
call npx react-native run-windows --release --arch x64 --no-launch
if %ERRORLEVEL% neq 0 (
    echo.
    echo ⚠️  Автоматическая сборка не удалась.
    echo    Попробуйте:
    echo    1. Открыть windows\SecureCallApp.sln в Visual Studio 2022
    echo    2. Выбрать Release / x64
    echo    3. Build → Build Solution
    echo.
    echo    Или из командной строки:
    echo    msbuild windows\SecureCallApp.sln /p:Configuration=Release /p:Platform=x64
    echo.
    pause
    exit /b %ERRORLEVEL%
)

echo [8/8] ✅ Сборка завершена!
echo.
echo ═══════════════════════════════════════════════════════
echo   Файлы приложения находятся в:
echo   windows\x64\Release\SecureCallApp\
echo.
echo   Для запуска:
echo   npx react-native run-windows --release --arch x64
echo ═══════════════════════════════════════════════════════
echo.
pause
