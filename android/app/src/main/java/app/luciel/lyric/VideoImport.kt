package app.luciel.lyric

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import kotlin.math.max
import kotlin.math.min

/**
 * Copies a picked video into bg.mp4, or transcodes 4K / HEVC / odd containers
 * down to H.264 so the WebView can play it. The lyric stage cover-crops to 9:16.
 */
object VideoImport {
    private const val MAX_EDGE = 1280
    private const val MAX_BYTES = 80L * 1024L * 1024L
    private const val MAX_DURATION_US = 10L * 60L * 1_000_000L

    fun import(context: Context, uri: Uri, onPhase: (String) -> Unit): String {
        val name = displayName(context, uri)
        val dest = File(context.filesDir, "bg.mp4")
        if (dest.exists()) dest.delete()
        val meta = probe(context, uri)
        if (meta.durationUs > MAX_DURATION_US) {
            error("That video is longer than 10 minutes. Trim it, then upload again.")
        }
        val heavy = meta.hevc || meta.longEdge > 1920 || meta.bytes > MAX_BYTES || !meta.avc || !meta.mp4
        if (!heavy) {
            onPhase("read")
            copy(context, uri, dest)
        } else {
            onPhase("convert")
            try {
                transcode(context, uri, dest, meta)
            } catch (e: Exception) {
                dest.delete()
                val why = e.message?.take(140) ?: "could not convert"
                error("Couldn't convert this video ($why). Try a shorter H.264 clip.")
            }
        }
        if (!dest.isFile || dest.length() < 32) {
            dest.delete()
            error("That file didn't include a video this phone can play.")
        }
        return name
    }

    fun displayName(context: Context, uri: Uri): String {
        if (uri.scheme == "file") return uri.lastPathSegment ?: "video"
        try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val n = c.getString(0)
                    if (!n.isNullOrBlank()) return n
                }
            }
        } catch (_: Exception) {
        }
        return uri.lastPathSegment ?: "video"
    }

    private class Probe(
        val width: Int,
        val height: Int,
        val rotation: Int,
        val durationUs: Long,
        val bytes: Long,
        val mime: String,
        val avc: Boolean,
        val hevc: Boolean,
        val mp4: Boolean,
    ) {
        val longEdge: Int get() = max(width, height)
    }

    private fun probe(context: Context, uri: Uri): Probe {
        val r = MediaMetadataRetriever()
        try {
            setRetriever(r, context, uri)
            val w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
            val h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
            val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
            val dur = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?.times(1000) ?: 0L
            val container = (r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE) ?: "").lowercase()
            if (w < 2 || h < 2) error("That file didn't include a video this phone can play.")
            val bytes = try {
                context.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: 0L
            } catch (_: Exception) {
                0L
            }
            val mime = trackMime(context, uri).ifBlank { container }
            val avc = mime == "video/avc" || mime.contains("avc1")
            val hevc = mime.contains("hevc") || mime.contains("hvc1") || mime.contains("dolby") || mime.contains("av01")
            return Probe(w, h, rot, dur, bytes, mime, avc && !hevc, hevc, container.contains("mp4"))
        } finally {
            try { r.release() } catch (_: Exception) {}
        }
    }

    private fun trackMime(context: Context, uri: Uri): String {
        val extractor = MediaExtractor()
        try {
            if (uri.scheme == "file") extractor.setDataSource(uri.path)
            else extractor.setDataSource(context, uri, null)
            for (i in 0 until extractor.trackCount) {
                val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("video/")) return mime.lowercase()
            }
        } catch (_: Exception) {
        } finally {
            try { extractor.release() } catch (_: Exception) {}
        }
        return ""
    }

    private fun setRetriever(r: MediaMetadataRetriever, context: Context, uri: Uri) {
        if (uri.scheme == "file") r.setDataSource(uri.path)
        else r.setDataSource(context, uri)
    }

    private fun copy(context: Context, uri: Uri, dest: File) {
        context.contentResolver.openInputStream(uri)?.use { input ->
            dest.outputStream().use { input.copyTo(it) }
        } ?: error("could not read that video")
    }

    private fun targetSize(width: Int, height: Int, rotation: Int): Pair<Int, Int> {
        var w = width
        var h = height
        if (rotation == 90 || rotation == 270) {
            w = height
            h = width
        }
        val edge = max(w, h).coerceAtLeast(2)
        val scale = min(1f, MAX_EDGE.toFloat() / edge)
        var ow = ((w * scale).toInt() / 2) * 2
        var oh = ((h * scale).toInt() / 2) * 2
        if (ow < 2) ow = 2
        if (oh < 2) oh = 2
        return ow to oh
    }

    private fun transcode(context: Context, uri: Uri, dest: File, meta: Probe) {
        val extractor = MediaExtractor()
        if (uri.scheme == "file") extractor.setDataSource(uri.path!!)
        else extractor.setDataSource(context, uri, null)
        var track = -1
        var format: MediaFormat? = null
        for (i in 0 until extractor.trackCount) {
            val f = extractor.getTrackFormat(i)
            val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("video/")) {
                track = i
                format = f
                break
            }
        }
        if (track < 0 || format == null) {
            extractor.release()
            error("no video track in that file")
        }
        extractor.selectTrack(track)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: error("unknown video codec")
        val (outW, outH) = targetSize(meta.width, meta.height, meta.rotation)
        val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        val outFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, outW, outH).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, android.media.MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, 2_500_000)
            setInteger(MediaFormat.KEY_FRAME_RATE, 30)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }
        encoder.configure(outFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val surface = encoder.createInputSurface()
        encoder.start()
        val decoder = MediaCodec.createDecoderByType(mime)
        decoder.configure(format, surface, null, 0)
        decoder.start()
        val muxer = MediaMuxer(dest.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var decoderDone = false
        var encoderDone = false
        var muxerStarted = false
        var muxTrack = -1
        val startedAt = System.nanoTime()
        try {
            while (!encoderDone) {
                if (System.nanoTime() - startedAt > 120_000_000_000L) error("converting took too long")
                if (!inputDone) {
                    val inIx = decoder.dequeueInputBuffer(10_000)
                    if (inIx >= 0) {
                        val buf = decoder.getInputBuffer(inIx)!!
                        val size = extractor.readSampleData(buf, 0)
                        if (size < 0) {
                            decoder.queueInputBuffer(inIx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            decoder.queueInputBuffer(inIx, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                if (!decoderDone) {
                    val outIx = decoder.dequeueOutputBuffer(info, 10_000)
                    if (outIx >= 0) {
                        val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                        decoder.releaseOutputBuffer(outIx, info.size > 0)
                        if (eos) {
                            decoderDone = true
                            encoder.signalEndOfInputStream()
                        }
                    }
                }
                val encIx = encoder.dequeueOutputBuffer(info, 10_000)
                when {
                    encIx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        muxTrack = muxer.addTrack(encoder.outputFormat)
                        muxer.start()
                        muxerStarted = true
                    }
                    encIx >= 0 -> {
                        val encoded = encoder.getOutputBuffer(encIx)!!
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                        if (info.size > 0 && muxerStarted) {
                            encoded.position(info.offset)
                            encoded.limit(info.offset + info.size)
                            muxer.writeSampleData(muxTrack, encoded, info)
                        }
                        encoder.releaseOutputBuffer(encIx, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) encoderDone = true
                    }
                }
            }
        } finally {
            try { decoder.stop() } catch (_: Exception) {}
            try { decoder.release() } catch (_: Exception) {}
            try { encoder.stop() } catch (_: Exception) {}
            try { encoder.release() } catch (_: Exception) {}
            try { surface.release() } catch (_: Exception) {}
            try {
                if (muxerStarted) muxer.stop()
            } catch (_: Exception) {}
            try { muxer.release() } catch (_: Exception) {}
            extractor.release()
        }
    }
}
