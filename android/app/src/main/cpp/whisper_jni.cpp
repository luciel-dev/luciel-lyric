#include <jni.h>
#include <android/log.h>
#include <string>
#include <sstream>
#include <iomanip>
#include <vector>
#include "whisper.h"

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "lucielwhisper", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "lucielwhisper", __VA_ARGS__)

static std::string json_escape(const char *text) {
    std::string out;
    if (!text) return out;
    for (const unsigned char *p = reinterpret_cast<const unsigned char *>(text); *p; ++p) {
        unsigned char c = *p;
        if (c == '"' || c == '\\') { out.push_back('\\'); out.push_back(static_cast<char>(c)); }
        else if (c == '\n' || c == '\r' || c == '\t') out.push_back(' ');
        else out.push_back(static_cast<char>(c));
    }
    return out;
}

static jstring to_jstring(JNIEnv *env, const std::string &s) {
    jclass cls = env->FindClass("java/lang/String");
    jmethodID ctor = env->GetMethodID(cls, "<init>", "([BLjava/lang/String;)V");
    jbyteArray bytes = env->NewByteArray(static_cast<jsize>(s.size()));
    if (!s.empty()) {
        env->SetByteArrayRegion(bytes, 0, static_cast<jsize>(s.size()), reinterpret_cast<const jbyte *>(s.data()));
    }
    jstring utf = env->NewStringUTF("UTF-8");
    return static_cast<jstring>(env->NewObject(cls, ctor, bytes, utf));
}

extern "C" JNIEXPORT jlong JNICALL
Java_app_luciel_lyric_WhisperEngine_nativeInit(JNIEnv *env, jobject, jstring path) {
    const char *cpath = env->GetStringUTFChars(path, nullptr);
    whisper_context_params cparams = whisper_context_default_params();
    cparams.use_gpu = false;
    whisper_context *ctx = whisper_init_from_file_with_params(cpath, cparams);
    env->ReleaseStringUTFChars(path, cpath);
    if (!ctx) {
        LOGE("whisper_init failed");
        return 0;
    }
    LOGI("whisper ready");
    return reinterpret_cast<jlong>(ctx);
}

extern "C" JNIEXPORT void JNICALL
Java_app_luciel_lyric_WhisperEngine_nativeFree(JNIEnv *, jobject, jlong handle) {
    if (handle) whisper_free(reinterpret_cast<whisper_context *>(handle));
}

extern "C" JNIEXPORT jstring JNICALL
Java_app_luciel_lyric_WhisperEngine_nativeTranscribe(JNIEnv *env, jobject, jlong handle, jfloatArray pcm, jint threads) {
    if (!handle) return to_jstring(env, "[]");
    auto *ctx = reinterpret_cast<whisper_context *>(handle);
    jsize n = env->GetArrayLength(pcm);
    std::vector<float> samples(static_cast<size_t>(n));
    env->GetFloatArrayRegion(pcm, 0, n, samples.data());

    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;
    params.print_special = false;
    params.translate = false;
    params.no_context = true;
    params.single_segment = false;
    params.language = "en";
    params.n_threads = threads > 0 ? threads : 2;
    params.suppress_blank = true;

    if (whisper_full(ctx, params, samples.data(), static_cast<int>(samples.size())) != 0) {
        LOGE("whisper_full failed");
        return to_jstring(env, "[]");
    }

    std::ostringstream json;
    json << std::fixed << std::setprecision(3);
    json << "[";
    bool first = true;
    const int nseg = whisper_full_n_segments(ctx);
    for (int i = 0; i < nseg; ++i) {
        const int nt = whisper_full_n_tokens(ctx, i);
        for (int j = 0; j < nt; ++j) {
            const char *raw = whisper_full_get_token_text(ctx, i, j);
            if (!raw || !raw[0]) continue;
            std::string text = raw;
            while (!text.empty() && (text[0] == ' ' || text[0] == '\n')) text.erase(text.begin());
            if (text.empty() || text[0] == '[' || text[0] == '<') continue;
            whisper_token_data data = whisper_full_get_token_data(ctx, i, j);
            double t0 = data.t0 / 100.0;
            double t1 = data.t1 / 100.0;
            if (t1 < t0) t1 = t0 + 0.05;
            if (!first) json << ",";
            first = false;
            json << "{\"text\":\"" << json_escape(text.c_str()) << "\",\"start\":" << t0 << ",\"end\":" << t1 << "}";
        }
    }
    json << "]";
    return to_jstring(env, json.str());
}
