import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val whisperDir = layout.projectDirectory.dir("third_party/whisper.cpp")
val whisperVersion = "1.7.6"

tasks.register("downloadWhisper") {
    val marker = whisperDir.file("CMakeLists.txt").asFile
    inputs.property("whisperVersion", whisperVersion)
    outputs.file(marker)
    doLast {
        val current = if (marker.exists()) marker.readText() else ""
        if (current.contains("VERSION $whisperVersion")) return@doLast
        val parent = whisperDir.asFile.parentFile
        parent.mkdirs()
        val tar = File.createTempFile("whisper", ".tar.gz")
        URI("https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v$whisperVersion.tar.gz").toURL().openStream().use { input ->
            tar.outputStream().use { input.copyTo(it) }
        }
        exec {
            commandLine("tar", "-xzf", tar.absolutePath, "-C", parent.absolutePath)
        }
        val extracted = File(parent, "whisper.cpp-$whisperVersion")
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
    from(rootProject.projectDir.parentFile.resolve("static/vendor")) { into("vendor") }
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
        versionCode = 155
        versionName = "1.5.5"
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
                storePassword = System.getenv("LUCIEL_KEYSTORE_PASSWORD")
                    ?: error("LUCIEL_KEYSTORE_PASSWORD is required to sign a release APK")
                keyAlias = System.getenv("LUCIEL_KEY_ALIAS")
                    ?: error("LUCIEL_KEY_ALIAS is required to sign a release APK")
                keyPassword = System.getenv("LUCIEL_KEY_PASSWORD")
                    ?: error("LUCIEL_KEY_PASSWORD is required to sign a release APK")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("ci")
                ?: error("Release APK requires the permanent keystore (LUCIEL_KEYSTORE_B64)")
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

    androidResources {
        noCompress += "bin"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.22.0")
}

val downloadQuickModel = tasks.register("downloadQuickModel") {
    val tiny = layout.buildDirectory.file("generated/assets/models/ggml-tiny.en.bin")
    val vad = layout.buildDirectory.file("generated/assets/models/ggml-silero-v5.1.2.bin")
    outputs.file(tiny)
    outputs.file(vad)
    doLast {
        val jobs = listOf(
            Triple(tiny.get().asFile, "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin", 70_000_000L),
            Triple(vad.get().asFile, "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin", 800_000L),
        )
        jobs.forEach { (dest, url, min) ->
            if (dest.isFile && dest.length() >= min) return@forEach
            dest.parentFile.mkdirs()
            val tmp = File(dest.absolutePath + ".part")
            val conn = (URI(url).toURL().openConnection() as java.net.HttpURLConnection).apply {
                instanceFollowRedirects = true
                connectTimeout = 30_000
                readTimeout = 180_000
                setRequestProperty("User-Agent", "LucielLyric/1.5.5")
            }
            conn.connect()
            if (conn.responseCode !in 200..299) {
                conn.disconnect()
                throw GradleException("voice model HTTP ${conn.responseCode} for ${dest.name}")
            }
            conn.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it) } }
            conn.disconnect()
            if (tmp.length() < min) {
                val got = tmp.length()
                tmp.delete()
                throw GradleException("${dest.name} looks incomplete ($got bytes)")
            }
            if (dest.exists()) dest.delete()
            if (!tmp.renameTo(dest)) throw GradleException("could not save ${dest.name}")
        }
    }
}

tasks.named("preBuild") {
    dependsOn("downloadWhisper", copyWeb, downloadQuickModel)
}

// CMake configure runs as its own task and will not see whisper.cpp unless this
// edge exists. merge*Assets must also wait for the copied web UI.
tasks.configureEach {
    if (name.startsWith("configureCMake") || name.startsWith("buildCMake") || name.startsWith("externalNativeBuild")) {
        dependsOn("downloadWhisper")
    }
    if (name.startsWith("merge") && name.endsWith("Assets")) {
        dependsOn(copyWeb, downloadQuickModel)
    }
}
