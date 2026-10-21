package app.luciel.lyric

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Speech and alignment weights. Each file is downloaded once and kept for offline sync. */
object ModelStore {
    data class Spec(val id: String, val name: String, val url: String, val minBytes: Long)

    val FAST = Spec(
        "fast",
        "ggml-tiny.en.bin",
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
        70_000_000L,
    )
    val ACCURATE = Spec(
        "accurate",
        "ggml-small.en-q5_1.bin",
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin",
        180_000_000L,
    )
    val VAD = Spec(
        "vad",
        "ggml-silero-v5.1.2.bin",
        "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin",
        800_000L,
    )
    val ALIGNER = Spec(
        "aligner",
        "wav2vec2-int8.onnx",
        "https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/main/onnx/model_int8.onnx",
        95_000_000L,
    )

    fun spec(id: String): Spec = if (id == "accurate") ACCURATE else FAST

    fun file(context: Context, spec: Spec = FAST): File = File(context.filesDir, spec.name)

    fun ready(context: Context, spec: Spec = FAST): Boolean {
        val f = file(context, spec)
        return f.isFile && f.length() >= spec.minBytes
    }

    fun download(context: Context, spec: Spec, onProgress: (Long, Long) -> Unit): File {
        val dest = file(context, spec)
        if (dest.isFile && dest.length() >= spec.minBytes) return dest
        val tmp = File(context.filesDir, spec.name + ".part")
        val conn = (URL(spec.url).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = true
            connectTimeout = 30_000
            readTimeout = 120_000
            setRequestProperty("User-Agent", "LucielLyric/1.4.3")
        }
        try {
            conn.connect()
            if (conn.responseCode !in 200..299) error("model download HTTP ${conn.responseCode}")
            val total = conn.contentLengthLong
            conn.inputStream.use { input ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    var got = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        got += n
                        onProgress(got, total)
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
        if (tmp.length() < spec.minBytes) {
            tmp.delete()
            error("download looks incomplete")
        }
        if (dest.exists()) dest.delete()
        if (!tmp.renameTo(dest)) error("could not save the download")
        return dest
    }
}
