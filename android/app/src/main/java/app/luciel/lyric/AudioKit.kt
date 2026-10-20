package app.luciel.lyric

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import org.json.JSONArray
import java.io.File
import java.io.RandomAccessFile
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Decodes the picked track to mono 16-bit PCM and a waveform overview. */
object AudioKit {
    data class Track(
        val pcm: File,
        val sampleRate: Int,
        val duration: Double,
        val peaks: JSONArray,
        val audioName: String,
    )

    fun decode(context: Context, path: String, audioName: String): Track {
        val extractor = MediaExtractor()
        extractor.setDataSource(path)
        var index = -1
        lateinit var format: MediaFormat
        for (i in 0 until extractor.trackCount) {
            val f = extractor.getTrackFormat(i)
            val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("audio/")) {
                index = i
                format = f
                break
            }
        }
        if (index < 0) error("that file has no audio track")
        extractor.selectTrack(index)
        val mime = format.getString(MediaFormat.KEY_MIME)!!
        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()
        val pcm = File(context.filesDir, "track.pcm")
        val out = pcm.outputStream().buffered()
        var sampleRate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 44100
        var channels = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 1
        var floatPcm = false
        val chunkPeaks = ArrayList<Int>()
        var acc = 0
        var peak = 0
        val chunk = 2048
        var samples = 0L
        val info = MediaCodec.BufferInfo()
        var inputEos = false
        var outputEos = false
        try {
            while (!outputEos) {
                if (!inputEos) {
                    val inIx = codec.dequeueInputBuffer(10_000)
                    if (inIx >= 0) {
                        val buf = codec.getInputBuffer(inIx)!!
                        val n = extractor.readSampleData(buf, 0)
                        if (n < 0) {
                            codec.queueInputBuffer(inIx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputEos = true
                        } else {
                            codec.queueInputBuffer(inIx, 0, n, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                when (val outIx = codec.dequeueOutputBuffer(info, 10_000)) {
                    MediaCodec.INFO_TRY_AGAIN_LATER -> {}
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val nf = codec.outputFormat
                        if (nf.containsKey(MediaFormat.KEY_SAMPLE_RATE)) sampleRate = nf.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        if (nf.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = nf.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        if (nf.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                            floatPcm = nf.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                        }
                    }
                    else -> if (outIx >= 0) {
                        val buf = codec.getOutputBuffer(outIx)!!
                        buf.position(info.offset)
                        buf.limit(info.offset + info.size)
                        val bytes = ByteArray(info.size)
                        buf.get(bytes)
                        val bps = if (floatPcm) 4 else 2
                        val frames = bytes.size / bps / max(1, channels)
                        var o = 0
                        for (i in 0 until frames) {
                            var sum = 0
                            for (c in 0 until channels) {
                                if (o + bps - 1 >= bytes.size) break
                                val s = if (floatPcm) {
                                    val bits = (bytes[o].toInt() and 0xff) or
                                        ((bytes[o + 1].toInt() and 0xff) shl 8) or
                                        ((bytes[o + 2].toInt() and 0xff) shl 16) or
                                        (bytes[o + 3].toInt() shl 24)
                                    (java.lang.Float.intBitsToFloat(bits) * 32767f).toInt()
                                } else {
                                    val lo = bytes[o].toInt() and 0xff
                                    val hi = bytes[o + 1].toInt()
                                    ((hi shl 8) or lo).toShort().toInt()
                                }
                                sum += s
                                o += bps
                            }
                            val mono = (sum / max(1, channels)).coerceIn(-32768, 32767)
                            out.write(mono and 0xff)
                            out.write((mono shr 8) and 0xff)
                            peak = max(peak, abs(mono))
                            acc++
                            samples++
                            if (acc >= chunk) {
                                chunkPeaks.add(peak)
                                peak = 0
                                acc = 0
                            }
                        }
                        codec.releaseOutputBuffer(outIx, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputEos = true
                    }
                }
            }
        } finally {
            out.flush()
            out.close()
            codec.stop()
            codec.release()
            extractor.release()
        }
        if (acc > 0) chunkPeaks.add(peak)
        if (samples < sampleRate / 4) error("could not read audio from that file")
        writePreview(pcm, sampleRate, File(context.filesDir, "preview.pcm"))
        val peaks = JSONArray()
        val n = 400
        if (chunkPeaks.isEmpty()) {
            for (i in 0 until n) peaks.put(0)
        } else {
            for (i in 0 until n) {
                val a = i * chunkPeaks.size / n
                val b = max(a + 1, (i + 1) * chunkPeaks.size / n)
                var m = 0
                for (k in a until min(b, chunkPeaks.size)) m = max(m, chunkPeaks[k])
                peaks.put(m / 32768.0)
            }
        }
        return Track(pcm, sampleRate, samples.toDouble() / sampleRate, peaks, audioName)
    }

    /** Whole song as little-endian float32 at 8 kHz, for the on-screen waveform. */
    private fun writePreview(pcm: File, sampleRate: Int, dest: File) {
        val outRate = 8000
        dest.outputStream().use { out ->
            RandomAccessFile(pcm, "r").use { raf ->
                val buf = ByteArray(64 * 1024)
                var inIndex = 0L
                var acc = 0.0
                var accN = 0
                var bucket = 0L
                fun flush() {
                    if (accN <= 0) return
                    val f = (acc / accN).toFloat().coerceIn(-1f, 1f)
                    val bits = f.toRawBits()
                    out.write(bits and 0xff)
                    out.write((bits shr 8) and 0xff)
                    out.write((bits shr 16) and 0xff)
                    out.write((bits ushr 24) and 0xff)
                }
                while (true) {
                    val n = raf.read(buf)
                    if (n < 2) break
                    var i = 0
                    while (i + 1 < n) {
                        val lo = buf[i].toInt() and 0xff
                        val hi = buf[i + 1].toInt()
                        val s = ((hi shl 8) or lo).toShort().toInt()
                        val outIndex = inIndex * outRate / sampleRate
                        if (outIndex != bucket) {
                            flush()
                            acc = 0.0
                            accN = 0
                            bucket = outIndex
                        }
                        acc += s / 32768.0
                        accN++
                        inIndex++
                        i += 2
                    }
                }
                flush()
            }
        }
    }

    /** Clip of the decoded track as 16 kHz float PCM for whisper.cpp. */
    fun clip16k(track: Track, startSec: Double, lengthSec: Double): FloatArray {
        val sr = track.sampleRate
        val start = max(0.0, startSec)
        val length = lengthSec.coerceIn(1.0, 30.0)
        val from = (start * sr).toLong()
        val count = (length * sr).toLong()
        val available = max(0L, track.pcm.length() / 2 - from)
        val n = min(count, available).toInt()
        if (n < sr / 5) error("that section is too short to sync")
        val raw = ShortArray(n)
        RandomAccessFile(track.pcm, "r").use { raf ->
            raf.seek(from * 2)
            val buf = ByteArray(n * 2)
            raf.readFully(buf)
            for (i in 0 until n) {
                val lo = buf[i * 2].toInt() and 0xff
                val hi = buf[i * 2 + 1].toInt()
                raw[i] = ((hi shl 8) or lo).toShort()
            }
        }
        val outRate = 16000
        val outN = max(1, (n.toLong() * outRate / sr).toInt())
        val out = FloatArray(outN)
        for (i in 0 until outN) {
            val src = i.toDouble() * sr / outRate
            val i0 = src.toInt().coerceIn(0, n - 1)
            val i1 = min(n - 1, i0 + 1)
            val f = (src - i0).toFloat()
            val s = raw[i0] * (1f - f) + raw[i1] * f
            out[i] = (s / 32768f).coerceIn(-1f, 1f)
        }
        return out
    }
}
