package app.luciel.lyric

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.io.FileInputStream

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var bridge: NativeBridge
    private var assetLoader: WebViewAssetLoader? = null

    private val pickAudio = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) bridge.onPickedAudio(uri)
    }
    private val pickVideo = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) bridge.onPickedVideo(uri)
    }
    private val pickFont = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) bridge.onPickedFont(uri)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        bridge = NativeBridge(this)
        webView = WebView(this)
        setContentView(webView)
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
        }
        webView.addJavascriptInterface(bridge, "Luciel")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url ?: return null
                if (url.path == "/files/custom.ttf") return fileResponse(File(filesDir, "custom.ttf"), "font/ttf")
                if (url.path == "/files/bg.mp4") return fileResponse(File(filesDir, "bg.mp4"), "video/mp4")
                return assetLoader?.shouldInterceptRequest(url)
            }
        }
        loadDemo(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        loadDemo(intent)
    }

    private fun loadDemo(intent: Intent?) {
        val demo = intent?.getStringExtra("demo")
        val q = if (demo.isNullOrBlank()) "" else "?demo=$demo"
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html$q")
    }

    fun web(): WebView? = if (::webView.isInitialized) webView else null

    fun launchAudio() = runOnUiThread { pickAudio.launch(arrayOf("audio/*")) }
    fun launchVideo() = runOnUiThread { pickVideo.launch(arrayOf("video/*")) }
    fun launchFont() = runOnUiThread { pickFont.launch(arrayOf("font/*", "application/octet-stream", "*/*")) }

    private fun fileResponse(file: File, mime: String): WebResourceResponse? {
        if (!file.isFile) return null
        return WebResourceResponse(mime, null, FileInputStream(file))
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
