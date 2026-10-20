import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val whisperDir = layout.projectDirectory.dir("third_party/whisper.cpp")

tasks.register("downloadWhisper") {
    val marker = whisperDir.file("CMakeLists.txt").asFile
    outputs.file(marker)
    onlyIf { !marker.exists() }
    doLast {
        val parent = whisperDir.asFile.parentFile
        parent.mkdirs()
        val tar = File.createTempFile("whisper", ".tar.gz")
        URI("https://github.com/ggerganov/whisper.cpp/archive/refs/tags/v1.7.5.tar.gz").toURL().openStream().use { input ->
            tar.outputStream().use { input.copyTo(it) }
        }
        exec {
            commandLine("tar", "-xzf", tar.absolutePath, "-C", parent.absolutePath)
        }
        val extracted = File(parent, "whisper.cpp-1.7.5")
        if (whisperDir.asFile.exists()) whisperDir.asFile.deleteRecursively()
        if (!extracted.renameTo(whisperDir.asFile)) {
            throw GradleException("could not move whisper.cpp into ${whisperDir.asFile}")
        }
        tar.delete()
    }
}

val copyWeb = tasks.register<Copy>("copyWeb") {
    into(layout.buildDirectory.dir("generated/assets/www"))
    from(rootProject.projectDir.parentFile.resolve("static/engine")) { into("engine") }
    from(rootProject.projectDir.parentFile.resolve("static/fonts")) { into("fonts") }
    from(rootProject.projectDir.parentFile.resolve("static/mascot")) { into("mascot") }
    from(rootProject.projectDir.resolve("src/mobile"))
}

android {
    namespace = "app.luciel.lyric"
    compileSdk = 35
    ndkVersion = "26.1.10909125"

    defaultConfig {
        applicationId = "app.luciel.lyric"
        minSdk = 26
        targetSdk = 35
        versionCode = 131
        versionName = "1.3.1"
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
        externalNativeBuild {
            cmake {
                arguments += listOf(
                    "-DWHISPER_DIR=${whisperDir.asFile.absolutePath}",
                    "-DANDROID_STL=c++_shared"
                )
                cppFlags += "-O3"
            }
        }
    }

    val keystore = file(System.getenv("LUCIEL_KEYSTORE") ?: "${rootProject.projectDir}/ci.keystore")
    signingConfigs {
        if (keystore.isFile) {
            create("ci") {
                storeFile = keystore
                storePassword = System.getenv("LUCIEL_KEYSTORE_PASSWORD") ?: "luciellyric"
                keyAlias = System.getenv("LUCIEL_KEY_ALIAS") ?: "luciel"
                keyPassword = System.getenv("LUCIEL_KEY_PASSWORD") ?: "luciellyric"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("ci") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/assets"))

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    packaging {
        jniLibs { useLegacyPackaging = true }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.webkit:webkit:1.11.0")
}

tasks.named("preBuild") {
    dependsOn("downloadWhisper", copyWeb)
}

// CMake configure runs as its own task and will not see whisper.cpp unless this
// edge exists. merge*Assets must also wait for the copied web UI.
tasks.configureEach {
    if (name.startsWith("configureCMake") || name.startsWith("buildCMake") || name.startsWith("externalNativeBuild")) {
        dependsOn("downloadWhisper")
    }
    if (name.startsWith("merge") && name.endsWith("Assets")) {
        dependsOn(copyWeb)
    }
}
