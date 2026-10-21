package app.luciel.lyric

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
 * Wav2vec2 CTC logits for typed lyrics. One intra-op thread: the default pool
 * moves a sung word by a fraction of a second. The WebView runs the same
 * Viterbi the desktop aligner uses.
 */
object LyricAligner {
    private var env: OrtEnvironment? = null
    private var session: OrtSession? = null
    private var loaded: String? = null

    fun logits(pcm: FloatArray, model: File): JSONObject {
        if (!model.isFile) error("lyric aligner is not downloaded")
        val ort = env ?: OrtEnvironment.getEnvironment().also { env = it }
        if (session == null || loaded != model.absolutePath) {
            session?.close()
            val opts = OrtSession.SessionOptions()
            opts.setIntraOpNumThreads(1)
            opts.setInterOpNumThreads(1)
            opts.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL)
            session = ort.createSession(model.absolutePath, opts)
            loaded = model.absolutePath
        }
        val current = session ?: error("could not read the lyric aligner")
        if (pcm.size < 16000 / 2) error("That clip is too short to align.")
        var mean = 0.0
        var sq = 0.0
        for (x in pcm) {
            val v = x.toDouble()
            mean += v
            sq += v * v
        }
        mean /= pcm.size
        val variance = sq / pcm.size - mean * mean
        val rms = kotlin.math.sqrt(kotlin.math.max(0.0, variance))
        if (rms < 0.004) error("This section is silent, so the lyrics can't be aligned.")
        val std = kotlin.math.sqrt(kotlin.math.max(variance, 0.0)) + 1e-7
        val norm = FloatArray(pcm.size) { ((pcm[it] - mean) / std).toFloat() }
        val shape = longArrayOf(1, norm.size.toLong())
        val input = OnnxTensor.createTensor(ort, FloatBuffer.wrap(norm), shape)
        val flat: FloatArray
        input.use {
            current.run(mapOf("input_values" to it)).use { result ->
                val value = result.get(0).value
                flat = flatten(value)
            }
        }
        if (flat.isEmpty() || flat.size % 32 != 0) error("aligner returned no frames")
        val bytes = ByteBuffer.allocate(flat.size * 4).order(ByteOrder.LITTLE_ENDIAN)
        bytes.asFloatBuffer().put(flat)
        val b64 = Base64.encodeToString(bytes.array(), Base64.NO_WRAP)
        return JSONObject()
            .put("frames", flat.size / 32)
            .put("duration", pcm.size / 16000.0)
            .put("logits", b64)
    }

    private fun flatten(value: Any?): FloatArray {
        if (value is Array<*>) {
            val rows = ArrayList<FloatArray>()
            fun walk(node: Any?) {
                when (node) {
                    is FloatArray -> rows.add(node)
                    is Array<*> -> node.forEach { walk(it) }
                }
            }
            walk(value)
            val n = rows.sumOf { it.size }
            val out = FloatArray(n)
            var at = 0
            for (row in rows) {
                row.copyInto(out, at)
                at += row.size
            }
            return out
        }
        error("unexpected aligner output")
    }
}
