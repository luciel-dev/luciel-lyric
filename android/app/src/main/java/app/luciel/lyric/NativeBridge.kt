package app.luciel.lyric

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

class NativeBridge(private val activity: MainActivity) {
    private val io = Executors.newSingleThreadExecutor()
    private val whisper = WhisperEngine()
    var track: AudioKit.Track? = null
    var videoPath: String? = null
    var fontPath: String? = null
    private var encoder: Mp4Encoder? = null
    private var lastRender: File? = null

    @android.webkit.JavascriptInterface
    fun info(): String {
        val model = ModelStore.ready(activity)
        return JSONObject()
            .put("version", "1.4.2")
            .put("model", model)
            .put("whisper", whisper.available)
            .put("demucs", false)
            .toString()
    }

    @android.webkit.JavascriptInterface
    fun pickAudio() = activity.launchAudio()

    @android.webkit.JavascriptInterface
    fun pickVideo() = activity.launchVideo()

    @android.webkit.JavascriptInterface
    fun removeVideo() {
        io.execute {
            val file = File(activity.filesDir, "bg.mp4")
            if (file.exists()) file.delete()
            videoPath = null
            val prefs = activity.getSharedPreferences("luciel", Context.MODE_PRIVATE)
            val saved = prefs.getString("videoUri", null)
            if (!saved.isNullOrBlank()) {
                try {
                    activity.contentResolver.releasePersistableUriPermission(
                        Uri.parse(saved),
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                    )
                } catch (_: Exception) {
                }
            }
            prefs.edit().remove("videoUri").remove("videoName").apply()
            emit("video", JSONObject().put("removed", true))
        }
    }

    @android.webkit.JavascriptInterface
    fun pickFont() = activity.launchFont()

    @android.webkit.JavascriptInterface
    fun downloadModel() {
        io.execute {
            try {
                if (ModelStore.ready(activity)) {
                    emit("model", JSONObject().put("ready", true).put("progress", 1))
                    return@execute
                }
                ModelStore.download(activity) { got, total ->
                    val p = if (total > 0) got.toDouble() / total else 0.0
                    emit("model", JSONObject().put("ready", false).put("progress", p).put("got", got).put("total", total))
                }
                emit("model", JSONObject().put("ready", true).put("progress", 1))
            } catch (e: Exception) {
                emit("model", JSONObject().put("ready", false).put("error", e.message ?: "download failed"))
            }
        }
    }

    @android.webkit.JavascriptInterface
    fun transcribe(start: Double, length: Double) {
        io.execute {
            try {
                val tr = track ?: error("pick a track first")
                if (!whisper.available) error("speech library missing from this build")
                if (!ModelStore.ready(activity)) error("download the speech model first")
                emit("sync", JSONObject().put("phase", "listen"))
                whisper.ensure(ModelStore.file(activity))
                val pcm = AudioKit.clip16k(tr, start, length)
                val words = whisper.transcribe(pcm)
                if (words.isBlank()) error("sync didn't return word timings")
                val arr = org.json.JSONArray(words)
                if (arr.length() == 0) error("nothing was heard in this section")
                emit("sync", JSONObject().put("phase", "words").put("words", arr))
            } catch (e: Exception) {
                emit("sync", JSONObject().put("phase", "error").put("error", e.message ?: "sync failed"))
            }
        }
    }

    @android.webkit.JavascriptInterface
    fun ready(screen: String) {
        android.util.Log.i("LucielReady", screen)
    }

    @android.webkit.JavascriptInterface
    fun beginRender(spec: String): String {
        return try {
            val o = JSONObject(spec)
            val w = o.getInt("width")
            val h = o.getInt("height")
            val fps = o.getInt("fps")
            val bitrate = o.getInt("bitrate")
            val start = o.optDouble("start", 0.0)
            val length = o.optDouble("length", 15.0)
            val file = File(activity.filesDir, "LucielLyric.mp4")
            if (file.exists()) file.delete()
            val enc = Mp4Encoder(file, w, h, fps, bitrate, track, start, length)
            enc.start()
            encoder = enc
            lastRender = file
            "ok"
        } catch (e: Exception) {
            encoder = null
            val message = e.message ?: "could not start the encoder"
            emit("render", JSONObject().put("error", message))
            message
        }
    }

    @android.webkit.JavascriptInterface
    fun frameStrip(y: Int, h: Int, b64: String) {
        val enc = encoder ?: return
        val bytes = Base64.decode(b64, Base64.DEFAULT)
        enc.fillStrip(y, h, bytes)
    }

    @android.webkit.JavascriptInterface
    fun commitFrame() {
        try {
            encoder?.commitFrame()
        } catch (e: Exception) {
            emit("render", JSONObject().put("error", e.message ?: "frame failed"))
        }
    }

    @android.webkit.JavascriptInterface
    fun finishRender() {
        // Same thread as beginRender / commitFrame. MediaCodec is not thread-safe.
        try {
            val file = encoder?.finish() ?: error("nothing to finish")
            encoder = null
            emit("render", JSONObject().put("path", file.absolutePath).put("bytes", file.length()))
        } catch (e: Exception) {
            encoder = null
            emit("render", JSONObject().put("error", e.message ?: "render failed"))
        }
    }

    @android.webkit.JavascriptInterface
    fun share() {
        val file = lastRender
        if (file == null || !file.isFile) {
            emit("render", JSONObject().put("error", "render a video first"))
            return
        }
        activity.runOnUiThread {
            val uri: Uri = FileProvider.getUriForFile(activity, "app.luciel.lyric.files", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "video/mp4"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(send, "Share lyric video"))
        }
    }

    fun onPickedAudio(uri: Uri) {
        io.execute {
            try {
                emit("track", JSONObject().put("phase", "decode"))
                val mime = activity.contentResolver.getType(uri) ?: ""
                val ext = when {
                    mime.contains("wav") -> "wav"
                    mime.contains("mpeg") || mime.contains("mp3") -> "mp3"
                    mime.contains("ogg") -> "ogg"
                    mime.contains("aac") -> "aac"
                    else -> "m4a"
                }
                activity.filesDir.listFiles()?.forEach { if (it.name.startsWith("track.")) it.delete() }
                val dest = File(activity.filesDir, "track.$ext")
                activity.contentResolver.openInputStream(uri)?.use { input ->
                    dest.outputStream().use { input.copyTo(it) }
                } ?: error("could not read that song")
                val tr = AudioKit.decode(activity, dest.absolutePath, dest.name)
                track = tr
                emit(
                    "track",
                    JSONObject()
                        .put("phase", "ready")
                        .put("duration", tr.duration)
                        .put("sampleRate", tr.sampleRate)
                        .put("peaks", tr.peaks)
                        .put("audio", tr.audioName)
                        .put("name", tr.audioName)
                )
            } catch (e: Exception) {
                emit("track", JSONObject().put("phase", "error").put("error", e.message ?: "could not read audio"))
            }
        }
    }

    fun rememberVideoUri(uri: Uri) {
        if (uri.scheme == "content") {
            activity.getSharedPreferences("luciel", Context.MODE_PRIVATE)
                .edit().putString("videoUri", uri.toString()).apply()
        }
    }

    fun restoreVideo() {
        val file = File(activity.filesDir, "bg.mp4")
        if (!file.isFile || file.length() < 32) return
        val name = activity.getSharedPreferences("luciel", Context.MODE_PRIVATE)
            .getString("videoName", file.name) ?: file.name
        videoPath = file.absolutePath
        emit("video", JSONObject().put("ok", true).put("name", name).put("restored", true))
    }

    fun onPickedVideo(uri: Uri) {
        io.execute {
            try {
                val name = VideoImport.import(activity, uri) { phase ->
                    emit("video", JSONObject().put("phase", phase))
                }
                val dest = File(activity.filesDir, "bg.mp4")
                videoPath = dest.absolutePath
                activity.getSharedPreferences("luciel", Context.MODE_PRIVATE)
                    .edit().putString("videoName", name).apply()
                emit("video", JSONObject().put("ok", true).put("name", name))
            } catch (e: Exception) {
                emit("video", JSONObject().put("ok", false).put("error", e.message ?: "could not read video"))
            }
        }
    }

    fun onPickedFont(uri: Uri) {
        io.execute {
            try {
                val dest = File(activity.filesDir, "custom.ttf")
                activity.contentResolver.openInputStream(uri)?.use { input ->
                    dest.outputStream().use { input.copyTo(it) }
                } ?: error("could not read that font")
                fontPath = dest.absolutePath
                emit("font", JSONObject().put("ok", true))
            } catch (e: Exception) {
                emit("font", JSONObject().put("ok", false).put("error", e.message ?: "could not read font"))
            }
        }
    }

    private fun emit(type: String, body: JSONObject) {
        body.put("type", type)
        val quoted = JSONObject.quote(body.toString())
        activity.runOnUiThread {
            activity.web()?.evaluateJavascript("window.LucielApp&&LucielApp.dispatch($quoted)", null)
        }
    }
}
