cmake_minimum_required(VERSION 3.22.1)
project(lucielwhisper)

if (NOT WHISPER_DIR)
    message(FATAL_ERROR "WHISPER_DIR is not set")
endif()
if (NOT EXISTS "${WHISPER_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "whisper.cpp is missing at ${WHISPER_DIR}. Run the downloadWhisper task.")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_CCACHE OFF CACHE BOOL "" FORCE)
set(GGML_AVX OFF CACHE BOOL "" FORCE)
set(GGML_AVX2 OFF CACHE BOOL "" FORCE)
set(GGML_FMA OFF CACHE BOOL "" FORCE)
set(GGML_F16C OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(GGML_BLAS OFF CACHE BOOL "" FORCE)

add_subdirectory(${WHISPER_DIR} ${CMAKE_BINARY_DIR}/whisper EXCLUDE_FROM_ALL)

add_library(lucielwhisper SHARED whisper_jni.cpp)
target_include_directories(lucielwhisper PRIVATE ${WHISPER_DIR}/include)
# Static ggml registers its CPU backend from object files nothing else calls.
# Pull the whole archives in or whisper_init finds no backend.
target_link_libraries(lucielwhisper
    -Wl,--whole-archive
    whisper
    ggml
    ggml-base
    ggml-cpu
    -Wl,--no-whole-archive
    log
    android
)
