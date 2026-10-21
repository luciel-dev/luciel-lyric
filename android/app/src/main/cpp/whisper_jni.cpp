#include <jni.h>
#include <android/log.h>
#include <string>
#include <sstream>
#include <iomanip>
#include <vector>
#include <cmath>
#include <algorithm>
#include "whisper.h"
#include "word_merge.h"

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

static void append_segment_words(whisper_context *ctx, std::vector<MergedWord> &words, float reject) {
    const whisper_token eot = whisper_token_eot(ctx);
    const int nseg = whisper_full_n_segments(ctx);
    for (int i = 0; i < nseg; ++i) {
        const double seg0 = whisper_full_get_segment_t0(ctx, i) / 100.0;
        const double seg1 = whisper_full_get_segment_t1(ctx, i) / 100.0;
        const float nosp = whisper_full_get_segment_no_speech_prob(ctx, i);
        std::vector<RawTok> toks;
        double psum = 0;
        int pc = 0;
        const int nt = whisper_full_n_tokens(ctx, i);
        for (int j = 0; j < nt; ++j) {
            const whisper_token id = whisper_full_get_token_id(ctx, i, j);
            if (id >= eot) continue;
            const char *raw = whisper_full_get_token_text(ctx, i, j);
            if (!raw || !raw[0]) continue;
            whisper_token_data data = whisper_full_get_token_data(ctx, i, j);
            double t0 = data.t0 > 0 ? data.t0 / 100.0 : 0;
            double t1 = data.t1 > 0 ? data.t1 / 100.0 : t0;
            if (t1 < t0) t1 = t0;
            toks.push_back({std::string(raw), t0, t1, data.p});
            psum += data.p;
            pc++;
        }
        if (toks.empty()) continue;
        const float mean = pc ? static_cast<float>(psum / pc) : 0.f;
        // Silence and very unsure segments are dropped. A later pass can retry
        // with the threshold at zero if that leaves nothing to align.
        if (nosp > 0.6f) continue;
        if (reject > 0.f && mean < reject) continue;
        auto segWords = merge_tokens(toks);
        if (segWords.empty()) continue;
        if (!times_varied(segWords)) assign_span(segWords, seg0, std::max(seg1, seg0));
        words.insert(words.end(), segWords.begin(), segWords.end());
    }
}

static whisper_full_params make_params(int threads, bool beam, const std::string &prompt) {
    whisper_full_params params = whisper_full_default_params(beam ? WHISPER_SAMPLING_BEAM_SEARCH : WHISPER_SAMPLING_GREEDY);
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
    params.suppress_nst = true;
    params.token_timestamps = true;
    params.no_speech_thold = 0.6f;
    params.temperature = 0.f;
    if (beam) params.beam_search.beam_size = 5;
    if (!prompt.empty()) params.initial_prompt = prompt.c_str();
    return params;
}

static bool decode_range(whisper_context *ctx, const std::vector<float> &samples, whisper_full_params params, int start_ms, int end_ms) {
    params.offset_ms = std::max(0, start_ms);
    params.duration_ms = std::max(0, end_ms - params.offset_ms);
    if (params.duration_ms > 0 && params.duration_ms < 120) return true;
    return whisper_full(ctx, params, samples.data(), static_cast<int>(samples.size())) == 0;
}

extern "C" JNIEXPORT jstring JNICALL
Java_app_luciel_lyric_WhisperEngine_nativeTranscribe(
        JNIEnv *env, jobject, jlong handle, jfloatArray pcm, jint threads,
        jstring vadPath, jstring prompt, jboolean beam, jfloat reject) {
    if (!handle) return to_jstring(env, "");
    auto *ctx = reinterpret_cast<whisper_context *>(handle);
    jsize n = env->GetArrayLength(pcm);
    std::vector<float> samples(static_cast<size_t>(n));
    env->GetFloatArrayRegion(pcm, 0, n, samples.data());

    std::string prompt_s;
    if (prompt) {
        const char *p = env->GetStringUTFChars(prompt, nullptr);
        if (p) {
            prompt_s = p;
            env->ReleaseStringUTFChars(prompt, p);
        }
    }
    if (prompt_s.size() > 200) prompt_s.resize(200);
    std::string vad_s;
    if (vadPath) {
        const char *p = env->GetStringUTFChars(vadPath, nullptr);
        if (p) {
            vad_s = p;
            env->ReleaseStringUTFChars(vadPath, p);
        }
    }

    const int thread_n = threads > 0 ? threads : 2;
    whisper_full_params params = make_params(thread_n, beam == JNI_TRUE, prompt_s);
    std::vector<MergedWord> words;
    bool decoded = false;

    if (!vad_s.empty()) {
        whisper_vad_context_params vcp = whisper_vad_default_context_params();
        whisper_vad_context *vctx = whisper_vad_init_from_file_with_params(vad_s.c_str(), vcp);
        if (!vctx) {
            LOGE("vad init failed");
            return to_jstring(env, "");
        }
        whisper_vad_params vp = whisper_vad_default_params();
        vp.threshold = 0.35f;
        vp.min_speech_duration_ms = 200;
        vp.min_silence_duration_ms = 250;
        vp.speech_pad_ms = 200;
        whisper_vad_segments *segs = whisper_vad_segments_from_samples(vctx, vp, samples.data(), static_cast<int>(samples.size()));
        const int ns = segs ? whisper_vad_segments_n_segments(segs) : 0;
        LOGI("vad segments %d", ns);
        for (int i = 0; i < ns; ++i) {
            // Times come back in centiseconds.
            const double t0 = whisper_vad_segments_get_segment_t0(segs, i) / 100.0;
            const double t1 = whisper_vad_segments_get_segment_t1(segs, i) / 100.0;
            const int a = std::max(0, static_cast<int>(t0 * 1000.0));
            const int b = std::max(a, static_cast<int>(t1 * 1000.0));
            whisper_full_params pass = make_params(thread_n, beam == JNI_TRUE, prompt_s);
            if (!decode_range(ctx, samples, pass, a, b)) {
                LOGE("whisper_full failed on vad segment");
                if (segs) whisper_vad_free_segments(segs);
                whisper_vad_free(vctx);
                return to_jstring(env, "");
            }
            decoded = true;
            append_segment_words(ctx, words, reject);
        }
        if (segs) whisper_vad_free_segments(segs);
        whisper_vad_free(vctx);
        if (!decoded) return to_jstring(env, "");
    } else {
        whisper_full_params pass = make_params(thread_n, beam == JNI_TRUE, prompt_s);
        if (!decode_range(ctx, samples, pass, 0, 0)) {
            LOGE("whisper_full failed");
            return to_jstring(env, "");
        }
        append_segment_words(ctx, words, reject);
    }

    double maxEnd = 0;
    for (const auto &w : words) maxEnd = std::max(maxEnd, w.end);
    const double audioLen = static_cast<double>(samples.size()) / 16000.0;
    if (words.empty() || (maxEnd < 0.25 && audioLen > 1.0)) {
        LOGE("no word timings (words=%d maxEnd=%.3f audio=%.2f)", static_cast<int>(words.size()), maxEnd, audioLen);
        return to_jstring(env, "");
    }

    std::sort(words.begin(), words.end(), [](const MergedWord &a, const MergedWord &b) { return a.start < b.start; });
    double prevEnd = 0;
    for (auto &w : words) {
        if (w.start < prevEnd) w.start = prevEnd;
        if (w.end < w.start + 0.02) w.end = w.start + 0.02;
        prevEnd = w.end;
    }

    std::ostringstream json;
    json << std::fixed << std::setprecision(3);
    json << "[";
    for (size_t i = 0; i < words.size(); ++i) {
        if (i) json << ",";
        json << "{\"text\":\"" << json_escape(words[i].text.c_str())
             << "\",\"start\":" << words[i].start
             << ",\"end\":" << words[i].end
             << ",\"confidence\":" << words[i].confidence << "}";
    }
    json << "]";
    return to_jstring(env, json.str());
}
