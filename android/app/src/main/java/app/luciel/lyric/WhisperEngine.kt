package app.luciel.lyric

import java.io.File

/** On-device whisper.cpp. Models stay in app storage so later syncs work offline. */
class WhisperEngine {
    private var handle: Long = 0
    private var loadedPath: String? = null

    val available: Boolean = try {
        System.loadLibrary("lucielwhisper")
        true
    } catch (e: UnsatisfiedLinkError) {
        false
    }

    fun ensure(model: File) {
        if (!available) error("speech library is not in this build")
        if (!model.isFile) error("speech model is not downloaded")
        if (handle != 0L && loadedPath == model.absolutePath) return
        if (handle != 0L) nativeFree(handle)
        handle = nativeInit(model.absolutePath)
        if (handle == 0L) error("could not read the speech model")
        loadedPath = model.absolutePath
    }

    fun transcribe(pcm: FloatArray, vad: File?, prompt: String, accurate: Boolean): String {
        if (handle == 0L) error("speech model is not loaded")
        val threads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)
        val vadPath = if (vad != null && vad.isFile && vad.length() > 100_000L) vad.absolutePath else ""
        val hint = prompt.take(200)
        var words = nativeTranscribe(handle, pcm, threads, vadPath, hint, accurate, 0.15f)
        if (words.isBlank()) {
            words = nativeTranscribe(handle, pcm, threads, "", hint, accurate, 0.08f)
        }
        if (words.isBlank()) {
            words = nativeTranscribe(handle, pcm, threads, "", hint, accurate, 0f)
        }
        return words
    }

    fun close() {
        if (handle != 0L) nativeFree(handle)
        handle = 0
        loadedPath = null
    }

    private external fun nativeInit(path: String): Long
    private external fun nativeFree(handle: Long)
    private external fun nativeTranscribe(
        handle: Long,
        pcm: FloatArray,
        threads: Int,
        vadPath: String,
        prompt: String,
        beam: Boolean,
        reject: Float,
    ): String
}
