# Исправление ошибки сборки APK

## Проблема
```
error: package com.imagepicker does not exist
import com.imagepicker.ImagePickerPackage;
```

## Что было сделано

### 1. ✅ Добавлен `react-native-image-picker` в зависимости
- **Файл**: `android/app/build.gradle`
- **Строка 231**: `implementation project(':react-native-image-picker')`

### 2. ✅ Явное подключение модуля в Gradle
- **Файл**: `android/settings.gradle`
- **Добавлено**: Явное `include ':react-native-image-picker'` с путём к node_modules

### 3. ✅ Создан `react-native.config.js` для автолинкинга

### 4. ✅ Очищены node_modules и переустановлены зависимости
```bash
rm -rf node_modules
npm install
```

## Как собрать APK на Windows / macOS

### Требования
- **Java**: JDK 17+ (не Java 21!)
- **Node.js**: 18+
- **Android SDK**: API 35 (targetSdkVersion)

### Шаги сборки

1. **Установить правильную Java версию** (если нужна)
   ```bash
   # На Windows, установите JDK 17 от Eclipse Adoptium:
   # https://adoptium.net/temurin/releases/?version=17
   ```

2. **Обновить путь к Java в gradle.properties**
   ```bash
   # android/gradle.properties
   # Для Windows:
   org.gradle.java.home=C:/Program Files/Eclipse Adoptium/jdk-17.0.18.8-hotspot
   # Для macOS:
   org.gradle.java.home=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home
   # Для Linux:
   org.gradle.java.home=/usr/lib/jvm/java-17-openjdk-amd64
   ```

3. **Очистить и пересобрать**
   ```bash
   cd android
   ./gradlew clean
   ./gradlew assembleRelease
   ```

   Или для debug:
   ```bash
   ./gradlew assembleDebug
   ```

4. **APK будет в**:
   ```
   android/app/build/outputs/apk/release/app-release.apk
   ```

## Что изменилось в коде

| Файл | Изменение |
|------|-----------|
| `android/app/build.gradle` | Добавлен `react-native-image-picker` в dependencies |
| `android/settings.gradle` | Явное включение модуля |
| `react-native.config.js` | Создан (для автолинкинга) |
| `android/gradle.properties` | Закомментирована Windows Java path |
| `ChatScreen.js` | Используется image-picker с try/catch (уже было) |

## Если всё ещё ошибка

1. **Очистить весь gradle кеш**
   ```bash
   rm -rf android/.gradle
   rm -rf android/app/build
   ./gradlew clean
   ```

2. **Проверить что image-picker установлен**
   ```bash
   ls node_modules/react-native-image-picker/
   ```

3. **Проверить Java версию**
   ```bash
   java -version
   ```
   Должно быть 17 или выше.

4. **Синхронизировать Gradle**
   ```bash
   ./gradlew sync
   ```
