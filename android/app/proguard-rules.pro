# ═══════════════════════════════════════════════════════════
# ЯДРО REACT NATIVE (RN 0.76 - 0.77+)
# ═══════════════════════════════════════════════════════════
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.soloader.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.react.internal.featureflags.** { *; }

# Защита методов JNI (критично для TurboModules и Fabric)
-keepclasseswithmembernames class * {
    native <methods>;
}
-keepclassmembers class * {
    native <methods>;
}

# ═══════════════════════════════════════════════════════════
# МОДУЛИ И БИБЛИОТЕКИ (ИЗ ВАШЕГО РАБОЧЕГО ФАЙЛА)
# ═══════════════════════════════════════════════════════════

# WebRTC (Видео/Аудио звонки)
-keep class org.webrtc.** { *; }
-keep class com.oney.WebRTCModule.** { *; }

# Firebase & Google Services
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }

# Notifee (Уведомления)
-keep class app.notifee.** { *; }

# AsyncStorage
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# Socket.IO & Сеть
-keep class io.socket.** { *; }
-keep class okhttp3.** { *; }
-keep class okio.** { *; }

# ═══════════════════════════════════════════════════════════
# СИСТЕМНЫЕ ПРАВИЛА ANDROID
# ═══════════════════════════════════════════════════════════
-keep public class * extends android.app.Activity
-keep public class * extends android.app.Application
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.content.ContentProvider

# Поддержка рефлексии для системных классов
-keepattributes *Annotation*, EnclosingMethod, Signature, InnerClasses

# Удаление логов в Production (Оптимизация)
# Раскомментируйте, если хотите полностью очистить логи из Release билда
#-assumenosideeffects class android.util.Log {
#    public static *** d(...);
#    public static *** v(...);
#    public static *** i(...);
#    public static *** w(...);
#    public static *** e(...);
#}