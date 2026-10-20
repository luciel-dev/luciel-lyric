package app.luciel.lyric

import java.io.File

/** On-device whisper.cpp. The English tiny model is downloaded once, then sync stays offline. */
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

    fun transcribe(pcm: FloatArray): String {
        if (handle == 0L) error("speech model is not loaded")
        val threads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)
        return nativeTranscribe(handle, pcm, threads)
    }

    fun close() {
        if (handle != 0L) nativeFree(handle)
        handle = 0
        loadedPath = null
    }

    private external fun nativeInit(path: String): Long
    private external fun nativeFree(handle: Long)
    private external fun nativeTranscribe(handle: Long, pcm: FloatArray, threads: Int): String
}
