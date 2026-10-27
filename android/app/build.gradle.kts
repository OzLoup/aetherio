import java.util.Properties


plugins {
    id("com.android.application")
}

// The web UI the app shows. Override for testing: ./gradlew assembleRelease -PwebUrl=http://192.168.1.10:5173
val webUrl = (project.findProperty("webUrl") as String?) ?: "https://aetherio-2y3.pages.dev"
val media3 = "1.9.0"

android {
    namespace = "com.aetherio.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.aetherio.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "WEB_URL", "\"$webUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // Release builds are signed with a local key (android/keystore.properties,
    // never committed). Without it, the release build falls back to the debug key.
    val keyProps = rootProject.file("keystore.properties")
    signingConfigs {
        if (keyProps.exists()) {
            val p = Properties().apply { keyProps.inputStream().use { load(it) } }
            create("release") {
                storeFile = rootProject.file(p.getProperty("storeFile"))
                storePassword = p.getProperty("storePassword")
                keyAlias = p.getProperty("keyAlias")
                keyPassword = p.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.annotation:annotation:1.9.1")
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    // Software decoders (AC3, E-AC3, DTS, TrueHD…) for boxes without them.
    implementation("org.jellyfin.media3:media3-ffmpeg-decoder:$media3+1")
}
