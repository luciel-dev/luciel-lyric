#include "word_merge.h"
#include <cmath>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

static int fail(const std::string &msg) {
    std::cerr << msg << "\n";
    return 1;
}

static int fixture() {
    const std::vector<RawTok> toks = {
        {" Sing", 0.20, 0.55},
        {" me", 0.55, 0.80},
        {" ,", 0.80, 0.86},
        {" far", 0.90, 1.20},
        {" away", 1.20, 1.70},
        {" ,", 1.70, 1.76},
        {" there", 1.80, 2.05},
        {"'s", 2.05, 2.25},
        {" be", 7.50, 7.70},
        {"avers", 7.70, 8.20},
    };
    const auto words = merge_tokens(toks);
    const std::vector<std::string> want = {"Sing", "me,", "far", "away,", "there's", "beavers"};
    if (words.size() != want.size()) return fail("fixture size " + std::to_string(words.size()));
    for (size_t i = 0; i < want.size(); ++i) {
        if (words[i].text != want[i]) return fail("fixture word " + words[i].text + " != " + want[i]);
        if (!(words[i].end > words[i].start)) return fail("fixture time " + words[i].text);
    }
    if (words[4].text != "there's" || !(words[4].end > 2.0)) return fail("there's timing");
    if (!(words[5].start >= 7.4 && words[5].end > 8.0)) return fail("beavers timing");

    std::vector<RawTok> flat = {
        {" be", 0, 0},
        {"avers", 0, 0},
        {" there", 0, 0},
        {"'s", 0, 0},
        {" away", 0, 0},
        {" ,", 0, 0},
    };
    auto zero = merge_tokens(flat);
    if (times_varied(zero)) return fail("zero times looked varied");
    if (zero.size() != 3 || zero[0].text != "beavers" || zero[1].text != "there's" || zero[2].text != "away,") {
        return fail("zero-time merge");
    }
    assign_span(zero, 1.0, 3.4);
    if (!times_varied(zero)) return fail("span did not vary");
    double prev = -1;
    for (const auto &w : zero) {
        if (!(w.start >= 0.99 && w.end <= 3.41 && w.end > w.start && w.start >= prev - 0.001)) return fail("span bounds");
        prev = w.start;
    }
    std::cout << "merge fixture ok\n";
    return 0;
}

static int from_stdin() {
    std::vector<RawTok> toks;
    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;
        std::stringstream ss(line);
        std::string a, b, text;
        if (!std::getline(ss, a, '\t')) continue;
        if (!std::getline(ss, b, '\t')) continue;
        std::getline(ss, text);
        RawTok tok;
        tok.t0 = std::atof(a.c_str());
        tok.t1 = std::atof(b.c_str());
        tok.text = text;
        toks.push_back(tok);
    }
    auto words = merge_tokens(toks);
    if (words.empty()) return fail("no words from audio tokens");
    // The phone sorts by start and closes gaps the same way. Tiny's token
    // times sometimes step backwards by a few tens of milliseconds.
    std::sort(words.begin(), words.end(), [](const MergedWord &a, const MergedWord &b) { return a.start < b.start; });
    double prevEnd = 0;
    for (auto &w : words) {
        if (w.start < prevEnd) w.start = prevEnd;
        if (w.end < w.start + 0.02) w.end = w.start + 0.02;
        prevEnd = w.end;
    }
    double prev = -1;
    double maxEnd = 0;
    bool moved = false;
    std::cout << "[";
    for (size_t i = 0; i < words.size(); ++i) {
        const auto &w = words[i];
        if (!(w.end > w.start) || w.start < prev - 0.05) return fail("non-monotonic " + w.text);
        if (w.start > 0.05) moved = true;
        if (w.end > maxEnd) maxEnd = w.end;
        prev = w.start;
        if (i) std::cout << ",";
        std::cout << "{\"text\":\"";
        for (char c : w.text) {
            if (c == '"' || c == '\\') std::cout << '\\';
            std::cout << c;
        }
        std::cout << "\",\"start\":" << w.start << ",\"end\":" << w.end << "}";
    }
    std::cout << "]\n";
    if (!moved || maxEnd < 4.0 || maxEnd > 30.0) return fail("audio timings out of range");
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 2) return fail("usage: merge_test fixture|stdin");
    const std::string mode = argv[1];
    if (mode == "fixture") return fixture();
    if (mode == "stdin") return from_stdin();
    return fail("unknown mode");
}
