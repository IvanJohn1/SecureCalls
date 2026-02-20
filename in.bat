@echo off
chcp 65001 > nul
setlocal

echo --- Запуск полной пересборки проекта SecureCallApp ---

:: 1. Установка зависимостей
echo [1/7] Установка зависимостей npm...
call npm install
if %ERRORLEVEL% neq 0 (
    echo Ошибка при npm install
    pause
    exit /b %ERRORLEVEL%
)

:: 2. Очистка временных папок
echo [2/7] Очистка кэша Metro и React...
powershell -Command "Remove-Item -Recurse -Force $env:TEMP\metro-* -ErrorAction Ignore"
powershell -Command "Remove-Item -Recurse -Force $env:TEMP\react-* -ErrorAction Ignore"

:: 3. Удаление старых ассетов
echo [3/7] Удаление старых ассетов Android...
if exist "android\app\src\main\assets" del /s /q "android\app\src\main\assets\*"
powershell -Command "Remove-Item -Recurse -Force .\android\app\src\main\res\drawable-* -ErrorAction Ignore"

:: 4. Генерация бандла
echo [4/7] Генерация JS Bundle...
if not exist "android\app\src\main\assets" mkdir "android\app\src\main\assets"
call npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output android\app\src\main\assets\index.android.bundle --assets-dest android\app\src\main\res
if %ERRORLEVEL% neq 0 (
    echo Ошибка при создании бандла
    pause
    exit /b %ERRORLEVEL%
)

:: 5. Переход в папку android и очистка
echo [5/7] Очистка Gradle...
cd android
call gradlew.bat clean
if %ERRORLEVEL% neq 0 (
    echo Ошибка Gradle Clean
    pause
    exit /b %ERRORLEVEL%
)

:: 6. Сборка APK
echo [6/7] Сборка Release APK...
call gradlew.bat assembleRelease
if %ERRORLEVEL% neq 0 (
    echo Ошибка сборки APK
    pause
    exit /b %ERRORLEVEL%
)

echo [7/7] Готово! APK находится в android\app\build\outputs\apk\release\
pause