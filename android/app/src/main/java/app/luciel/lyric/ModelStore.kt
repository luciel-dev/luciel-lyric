package app.luciel.lyric

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** ggml-tiny.en (~75 MB). Kept in app storage so later syncs work with no network. */
object ModelStore {
    const val URL_TINY_EN = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin"
    private const val NAME = "ggml-tiny.en.bin"

    fun file(context: Context): File = File(context.filesDir, NAME)

    fun ready(context: Context): Boolean {
        val f = file(context)
        return f.isFile && f.length() > 20_000_000L
    }

    fun download(context: Context, onProgress: (Long, Long) -> Unit): File {
        val dest = file(context)
        val tmp = File(context.filesDir, "$NAME.part")
        val conn = (URL(URL_TINY_EN).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = true
            connectTimeout = 30_000
            readTimeout = 60_000
            setRequestProperty("User-Agent", "LucielLyric/1.3.0")
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
        if (tmp.length() < 20_000_000L) {
            tmp.delete()
            error("speech model download looks incomplete")
        }
        if (dest.exists()) dest.delete()
        if (!tmp.renameTo(dest)) error("could not save the speech model")
        return dest
    }
}
