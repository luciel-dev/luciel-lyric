#pragma once
// Whisper emits one token per subword. A leading space starts a new word;
// "be" + "avers" is one word, and "'" + "s" stays inside "there's".
#include <algorithm>
#include <cctype>
#include <cmath>
#include <string>
#include <vector>

struct RawTok {
    std::string text;
    double t0 = 0;
    double t1 = 0;
};

struct MergedWord {
    std::string text;
    double start = 0;
    double end = 0;
};

inline bool wm_space(unsigned char c) {
    return c == ' ' || c == '\n' || c == '\t' || c == '\r';
}

inline bool wm_apos(const std::string &s) {
    if (s.empty()) return false;
    if (s[0] == '\'') return true;
    return s.size() >= 3
        && static_cast<unsigned char>(s[0]) == 0xE2
        && static_cast<unsigned char>(s[1]) == 0x80
        && (static_cast<unsigned char>(s[2]) == 0x99 || static_cast<unsigned char>(s[2]) == 0x98);
}

inline bool wm_punct(const std::string &s) {
    if (s.empty()) return false;
    for (unsigned char c : s) {
        if (std::isalnum(c)) return false;
    }
    return true;
}

inline std::vector<MergedWord> merge_tokens(const std::vector<RawTok> &toks) {
    std::vector<MergedWord> words;
    for (const auto &tok : toks) {
        if (tok.text.empty()) continue;
        size_t i = 0;
        while (i < tok.text.size() && wm_space(static_cast<unsigned char>(tok.text[i]))) i++;
        if (i >= tok.text.size()) continue;
        const std::string piece = tok.text.substr(i);
        if (piece[0] == '[' || piece[0] == '<') continue;
        const bool boundary = words.empty() || wm_space(static_cast<unsigned char>(tok.text[0]));
        if (!words.empty() && !boundary) {
            words.back().text += piece;
            words.back().end = std::max(words.back().end, tok.t1);
            if (words.back().start <= 0.0 && tok.t0 > 0.0) words.back().start = tok.t0;
            continue;
        }
        if (!words.empty() && (wm_punct(piece) || wm_apos(piece))) {
            words.back().text += piece;
            words.back().end = std::max(words.back().end, tok.t1);
            continue;
        }
        MergedWord w;
        w.text = piece;
        w.start = tok.t0;
        w.end = std::max(tok.t1, tok.t0);
        words.push_back(w);
    }
    return words;
}

inline bool times_varied(const std::vector<MergedWord> &words) {
    if (words.empty()) return false;
    if (words.size() == 1) return words[0].end > words[0].start + 0.02 && words[0].end > 0.05;
    const double origin = words[0].start;
    for (const auto &w : words) {
        if (std::fabs(w.start - origin) > 0.03) return true;
    }
    return false;
}

inline void assign_span(std::vector<MergedWord> &words, double t0, double t1) {
    if (words.empty()) return;
    double tot = 0;
    for (const auto &w : words) tot += std::max(1.0, static_cast<double>(w.text.size()));
    double span = t1 - t0;
    const double floor = 0.05 * static_cast<double>(words.size());
    if (span < floor) span = floor;
    double acc = t0;
    for (auto &w : words) {
        const double d = span * std::max(1.0, static_cast<double>(w.text.size())) / tot;
        w.start = acc;
        w.end = acc + d;
        acc += d;
    }
}
