package app.luciel.lyric

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.io.FileInputStream

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var bridge: NativeBridge
    private var assetLoader: WebViewAssetLoader? = null
    private var pageReady = false
    private var insetTopPx = 0
    private var insetBottomPx = 0
    private var textZoom = 100

    private val pickAudio = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) bridge.onPickedAudio(uri)
    }
    private val pickVideo = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            try {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (_: Exception) {
            }
            bridge.rememberVideoUri(uri)
            bridge.onPickedVideo(uri)
        }
    }
    private val pickFont = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) bridge.onPickedFont(uri)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        bridge = NativeBridge(this)
        webView = WebView(this)
        setContentView(webView)
        ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            insetTopPx = bars.top
            insetBottomPx = bars.bottom
            pushInsets()
            insets
        }
        val files = WebViewAssetLoader.InternalStoragePathHandler(this, filesDir)
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/files/", files)
            .build()
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            builtInZoomControls = false
            displayZoomControls = false
            minimumFontSize = 1
        }
        webView.addJavascriptInterface(bridge, "Luciel")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url ?: return null
                if (url.path == "/files/custom.ttf") return fileResponse(File(filesDir, "custom.ttf"), "font/ttf")
                if (url.path == "/files/bg.mp4") return videoResponse(request)
                return assetLoader?.shouldInterceptRequest(url)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                pageReady = true
                pushInsets()
                deliverVideo(intent)
            }
        }
        ViewCompat.requestApplyInsets(webView)
        loadDemo(intent)
    }

    private fun applyTextZoom(intent: Intent?) {
        val extra = intent?.getStringExtra("textZoom")?.toFloatOrNull()
        val zoom = (extra ?: (resources.configuration.fontScale * 100f)).toInt().coerceIn(80, 200)
        textZoom = zoom
        if (::webView.isInitialized) webView.settings.textZoom = zoom
    }

    private fun pushInsets() {
        if (!pageReady || !::webView.isInitialized) return
        val density = resources.displayMetrics.density.coerceAtLeast(0.5f)
        val top = maxOf(insetTopPx / density, 48f)
        val bottom = maxOf(insetBottomPx / density, 32f)
        webView.evaluateJavascript(
            "document.documentElement.style.setProperty('--sys-top','${top}px');document.documentElement.style.setProperty('--sys-bottom','${bottom}px');document.documentElement.dataset.textZoom='${textZoom}';",
            null
        )
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        loadDemo(intent)
    }

    private fun loadDemo(intent: Intent?) {
        val demo = intent?.getStringExtra("demo").orEmpty()
        val theme = intent?.getStringExtra("theme").orEmpty()
        applyTextZoom(intent)
        val parts = ArrayList<String>()
        if (demo.isNotBlank()) parts.add("demo=" + Uri.encode(demo))
        if (theme.isNotBlank()) parts.add("theme=" + Uri.encode(theme))
        parts.add("textZoom=" + textZoom)
        if (!intent?.getStringExtra("videoUri").isNullOrBlank()) parts.add("videoPending=1")
        val q = "?" + parts.joinToString("&")
        pageReady = false
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html$q")
    }

    fun web(): WebView? = if (::webView.isInitialized) webView else null

    fun launchAudio() = runOnUiThread { pickAudio.launch(arrayOf("audio/*")) }
    fun launchVideo() = runOnUiThread { pickVideo.launch(arrayOf("video/*")) }
    fun launchFont() = runOnUiThread { pickFont.launch(arrayOf("font/*", "application/octet-stream", "*/*")) }

    private fun deliverVideo(intent: Intent?) {
        val raw = intent?.getStringExtra("videoUri").orEmpty()
        if (raw.isNotBlank()) {
            val uri = openInjected(raw) ?: return
            bridge.onPickedVideo(uri)
            return
        }
        bridge.restoreVideo()
    }

    private fun openInjected(raw: String): Uri? {
        if (raw.startsWith("asset:")) {
            val name = raw.removePrefix("asset:")
            return try {
                val out = File(cacheDir, name.substringAfterLast('/'))
                assets.open(name).use { input -> out.outputStream().use { input.copyTo(it) } }
                Uri.fromFile(out)
            } catch (_: Exception) {
                null
            }
        }
        return Uri.parse(raw)
    }

    private fun fileResponse(file: File, mime: String): WebResourceResponse? {
        if (!file.isFile) return null
        val response = WebResourceResponse(mime, null, FileInputStream(file))
        if (mime.startsWith("video/")) {
            response.setStatusCodeAndReasonPhrase(200, "OK")
            response.responseHeaders = mapOf(
                "Content-Type" to mime,
                "Content-Length" to file.length().toString(),
                "Accept-Ranges" to "bytes",
                "Cache-Control" to "no-store",
            )
        }
        return response
    }

    /** WebView's media player asks for byte ranges. A full-file 200 often never paints a frame. */
    private fun videoResponse(request: WebResourceRequest): WebResourceResponse? {
        val file = File(filesDir, "bg.mp4")
        if (!file.isFile) return null
        val len = file.length()
        if (len < 32) return null
        val headers = request.requestHeaders
        val range = headers["Range"] ?: headers["range"]
        if (range.isNullOrBlank() || !range.startsWith("bytes=")) return fileResponse(file, "video/mp4")
        val spec = range.removePrefix("bytes=").substringBefore(",")
        val bits = spec.split("-")
        val start = bits.getOrNull(0)?.toLongOrNull() ?: 0L
        val endIncl = bits.getOrNull(1)?.toLongOrNull() ?: (len - 1)
        val from = start.coerceIn(0L, (len - 1).coerceAtLeast(0L))
        val to = endIncl.coerceIn(from, len - 1)
        val count = to - from + 1
        val response = WebResourceResponse("video/mp4", null, RangeStream(file, from, count))
        response.setStatusCodeAndReasonPhrase(206, "Partial Content")
        response.responseHeaders = mapOf(
            "Content-Type" to "video/mp4",
            "Content-Length" to count.toString(),
            "Content-Range" to "bytes $from-$to/$len",
            "Accept-Ranges" to "bytes",
            "Cache-Control" to "no-store",
        )
        return response
    }

    private class RangeStream(file: File, from: Long, private var left: Long) : java.io.InputStream() {
        private val raf = java.io.RandomAccessFile(file, "r").also { it.seek(from) }
        override fun read(): Int {
            if (left <= 0L) return -1
            val b = raf.read()
            if (b >= 0) left--
            return b
        }
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (left <= 0L) return -1
            val n = raf.read(b, off, minOf(len.toLong(), left).toInt())
            if (n > 0) left -= n
            return n
        }
        override fun close() {
            raf.close()
        }
    }

    @Deprecated("back")
    override fun onBackPressed() {
        webView.evaluateJavascript("(window.LucielApp&&LucielApp.back())||false") { handled ->
            if (handled == "false") {
                @Suppress("DEPRECATION")
                super.onBackPressed()
            }
        }
    }
}
