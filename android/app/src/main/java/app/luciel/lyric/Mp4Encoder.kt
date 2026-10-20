package app.luciel.lyric

import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.min

/**
 * H.264 + AAC MP4. Frames arrive as RGBA strips from the WebView lyric engine.
 * Quality presets mirror the desktop ones; Max stays 1080p30 because 60 fps
 * full-raster through a WebView is not reliable on a phone.
 */
class Mp4Encoder(
    private val out: File,
    private val width: Int,
    private val height: Int,
    private val fps: Int,
    private val bitrate: Int,
    private val audio: AudioKit.Track?,
    private val audioStart: Double,
    private val audioLength: Double,
) {
    private val pixels = IntArray(width * height)
    private val yuv = ByteArray(width * height * 3 / 2)
    private var videoCodec: MediaCodec? = null
    private var muxer: MediaMuxer? = null
    private var videoTrack = -1
    private var audioTrack = -1
    private var muxerStarted = false
    private val videoPending = ArrayList<Sample>()
    private var audioSamples: List<Sample> = emptyList()
    private var audioFormat: MediaFormat? = null
    private var frameIndex = 0
    private var colorFormat = MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar

    private class Sample(val data: ByteArray, val info: MediaCodec.BufferInfo)

    fun start() {
        if (width % 2 != 0 || height % 2 != 0) error("frame size must be even")
        audio?.let { prepareAudio(it) }
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height)
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        colorFormat = chooseColor(codec)
        format.setInteger(MediaFormat.KEY_COLOR_FORMAT, colorFormat)
        format.setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
        format.setInteger(MediaFormat.KEY_FRAME_RATE, fps)
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
        videoCodec = codec
        muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    }

    fun fillStrip(y: Int, h: Int, rgba: ByteArray) {
        val rows = min(h, height - y)
        var o = 0
        for (row in 0 until rows) {
            val base = (y + row) * width
            for (x in 0 until width) {
                if (o + 3 >= rgba.size) return
                val r = rgba[o].toInt() and 0xff
                val g = rgba[o + 1].toInt() and 0xff
                val b = rgba[o + 2].toInt() and 0xff
                val a = rgba[o + 3].toInt() and 0xff
                pixels[base + x] = (a shl 24) or (r shl 16) or (g shl 8) or b
                o += 4
            }
        }
    }

    fun commitFrame() {
        val codec = videoCodec ?: return
        argbToYuv()
        val inIx = codec.dequeueInputBuffer(20_000)
        if (inIx < 0) error("encoder busy")
        val buf = codec.getInputBuffer(inIx)!!
        buf.clear()
        if (yuv.size > buf.capacity()) error("frame does not fit the encoder")
        buf.put(yuv)
        val pts = frameIndex * 1_000_000L / fps
        codec.queueInputBuffer(inIx, 0, yuv.size, pts, 0)
        frameIndex++
        drain(codec, end = false)
    }

    fun finish(): File {
        val codec = videoCodec ?: error("encoder was not started")
        val inIx = codec.dequeueInputBuffer(20_000)
        if (inIx >= 0) {
            codec.queueInputBuffer(inIx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
        }
        drain(codec, end = true)
        writeAudio()
        try {
            if (muxerStarted) muxer?.stop()
        } catch (_: Exception) {
        }
        muxer?.release()
        codec.stop()
        codec.release()
        videoCodec = null
        muxer = null
        if (!out.isFile || out.length() < 32) error("render produced an empty file")
        return out
    }

    private fun chooseColor(codec: MediaCodec): Int {
        val caps = codec.codecInfo.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC).colorFormats
        val prefer = intArrayOf(
            MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar,
            MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Planar,
        )
        return prefer.firstOrNull { it in caps } ?: caps.first()
    }

    private fun argbToYuv() {
        val w = width
        val h = height
        var o = 0
        for (j in 0 until h) {
            for (i in 0 until w) {
                val c = pixels[j * w + i]
                val r = (c shr 16) and 0xff
                val g = (c shr 8) and 0xff
                val b = c and 0xff
                val y = ((66 * r + 129 * g + 25 * b + 128) shr 8) + 16
                yuv[o++] = y.coerceIn(0, 255).toByte()
            }
        }
        val planar = colorFormat == MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Planar
        if (planar) {
            var uo = w * h
            var vo = uo + (w * h) / 4
            for (j in 0 until h step 2) {
                for (i in 0 until w step 2) {
                    val (u, v) = uvAt(i, j)
                    yuv[uo++] = u
                    yuv[vo++] = v
                }
            }
        } else {
            var uvo = w * h
            for (j in 0 until h step 2) {
                for (i in 0 until w step 2) {
                    val (u, v) = uvAt(i, j)
                    yuv[uvo++] = u
                    yuv[uvo++] = v
                }
            }
        }
    }

    private fun uvAt(i: Int, j: Int): Pair<Byte, Byte> {
        var r = 0
        var g = 0
        var b = 0
        var n = 0
        for (dy in 0..1) for (dx in 0..1) {
            val x = min(width - 1, i + dx)
            val y = min(height - 1, j + dy)
            val c = pixels[y * width + x]
            r += (c shr 16) and 0xff
            g += (c shr 8) and 0xff
            b += c and 0xff
            n++
        }
        r /= n; g /= n; b /= n
        val u = ((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128
        val v = ((112 * r - 94 * g - 18 * b + 128) shr 8) + 128
        return u.coerceIn(0, 255).toByte() to v.coerceIn(0, 255).toByte()
    }

    private fun drain(codec: MediaCodec, end: Boolean) {
        val info = MediaCodec.BufferInfo()
        var spins = 0
        while (true) {
            val outIx = codec.dequeueOutputBuffer(info, if (end) 10_000 else 0)
            when {
                outIx == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                    if (!end || ++spins > 200) return
                }
                outIx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    videoTrack = ensureMuxer(codec.outputFormat)
                }
                outIx >= 0 -> {
                    val buf = codec.getOutputBuffer(outIx)
                    if (buf != null && info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                        val bytes = ByteArray(info.size)
                        buf.position(info.offset)
                        buf.limit(info.offset + info.size)
                        buf.get(bytes)
                        val copy = MediaCodec.BufferInfo()
                        copy.set(0, bytes.size, info.presentationTimeUs, info.flags)
                        val sample = Sample(bytes, copy)
                        if (muxerStarted && videoTrack >= 0) writeSample(videoTrack, sample)
                        else videoPending.add(sample)
                    }
                    codec.releaseOutputBuffer(outIx, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                }
                else -> return
            }
        }
    }

    private fun ensureMuxer(videoFormat: MediaFormat): Int {
        val mx = muxer ?: return -1
        if (videoTrack < 0) videoTrack = mx.addTrack(videoFormat)
        if (audioFormat != null && audioTrack < 0) audioTrack = mx.addTrack(audioFormat!!)
        if (!muxerStarted) {
            mx.start()
            muxerStarted = true
            for (sample in videoPending) writeSample(videoTrack, sample)
            videoPending.clear()
        }
        return videoTrack
    }

    private fun writeSample(track: Int, sample: Sample) {
        val mx = muxer ?: return
        val buf = ByteBuffer.wrap(sample.data)
        mx.writeSampleData(track, buf, sample.info)
    }

    private fun writeAudio() {
        if (!muxerStarted || audioTrack < 0) return
        for (sample in audioSamples) writeSample(audioTrack, sample)
    }

    private fun prepareAudio(track: AudioKit.Track) {
        val srIn = track.sampleRate
        val sr = if (srIn in setOf(16000, 22050, 24000, 32000, 44100, 48000)) srIn else 44100
        val start = max(0L, (audioStart * srIn).toLong())
        val countIn = max(1L, (audioLength * srIn).toLong())
        val available = max(0L, track.pcm.length() / 2 - start)
        val nIn = min(countIn, available).toInt()
        if (nIn < 100) return
        val pcm = ShortArray(nIn)
        RandomAccessFile(track.pcm, "r").use { raf ->
            raf.seek(start * 2)
            val buf = ByteArray(nIn * 2)
            val got = raf.read(buf)
            val frames = max(0, got / 2)
            for (i in 0 until frames) {
                val lo = buf[i * 2].toInt() and 0xff
                val hi = buf[i * 2 + 1].toInt()
                pcm[i] = ((hi shl 8) or lo).toShort()
            }
        }
        val samples = if (sr == srIn) pcm else resample(pcm, srIn, sr)
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sr, 1)
        format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        format.setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
        format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
        val collected = ArrayList<Sample>()
        var offset = 0
        var inEos = false
        var outEos = false
        var steps = 0
        val info = MediaCodec.BufferInfo()
        try {
            while (!outEos && steps++ < 20000) {
                if (!inEos) {
                    val inIx = codec.dequeueInputBuffer(10_000)
                    if (inIx >= 0) {
                        val buf = codec.getInputBuffer(inIx)!!
                        buf.clear()
                        val bytesRoom = buf.capacity() / 2
                        val n = min(bytesRoom, samples.size - offset)
                        if (n <= 0) {
                            codec.queueInputBuffer(inIx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inEos = true
                        } else {
                            for (i in 0 until n) {
                                val s = samples[offset + i].toInt()
                                buf.put((s and 0xff).toByte())
                                buf.put(((s shr 8) and 0xff).toByte())
                            }
                            val pts = offset * 1_000_000L / sr
                            codec.queueInputBuffer(inIx, 0, n * 2, pts, 0)
                            offset += n
                        }
                    }
                }
                val outIx = codec.dequeueOutputBuffer(info, 10_000)
                when {
                    outIx == MediaCodec.INFO_TRY_AGAIN_LATER -> {}
                    outIx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> audioFormat = codec.outputFormat
                    outIx >= 0 -> {
                        val buf = codec.getOutputBuffer(outIx)
                        if (buf != null && info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                            val bytes = ByteArray(info.size)
                            buf.position(info.offset)
                            buf.limit(info.offset + info.size)
                            buf.get(bytes)
                            val copy = MediaCodec.BufferInfo()
                            copy.set(0, bytes.size, info.presentationTimeUs, info.flags)
                            collected.add(Sample(bytes, copy))
                        }
                        val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                        codec.releaseOutputBuffer(outIx, false)
                        if (eos) outEos = true
                    }
                }
            }
        } finally {
            codec.stop()
            codec.release()
        }
        audioSamples = collected
    }

    private fun resample(input: ShortArray, from: Int, to: Int): ShortArray {
        val n = max(1, (input.size.toLong() * to / from).toInt())
        val out = ShortArray(n)
        for (i in 0 until n) {
            val src = i.toDouble() * from / to
            val i0 = src.toInt().coerceIn(0, input.size - 1)
            val i1 = min(input.size - 1, i0 + 1)
            val f = (src - i0).toFloat()
            val s = input[i0] * (1f - f) + input[i1] * f
            out[i] = s.toInt().coerceIn(-32768, 32767).toShort()
        }
        return out
    }
}
