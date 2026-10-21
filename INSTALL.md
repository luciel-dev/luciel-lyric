# Luciel Lyric: install in 3 steps

Luciel Lyric makes short lyric videos (15–30 seconds) from your songs. It runs on your own computer, and your music is never uploaded anywhere.

1. **Download and unzip** `LucielLyric-lite.zip`.
   * Put the `LucielLyric` folder somewhere permanent, e.g. *Documents*.
   * Windows: right-click the zip → *Extract All*. Don't run it from inside the zip.
2. **Double-click Install.** It takes 5–20 minutes and needs internet this one time.
   * **Windows:** `Install.bat`
   * **Mac:** `Install.command`
   * **Linux:** run `./install.sh` in a terminal
3. **Double-click Start Luciel Lyric.** Your browser opens the app.
   * **Windows:** `Start Luciel Lyric.bat`
   * **Mac:** `Start Luciel Lyric.command`
   * **Linux:** `./start.sh`
   * Install also starts the app the first time it finishes.

That's it. After installing, Luciel Lyric works **without internet**.

**You don't need to install Python** or anything else. If you already have Python, whatever the version (3.15 included), it is simply ignored. The installer downloads its own private copy into the LucielLyric folder. Nothing is installed elsewhere on your computer.

---

## Troubleshooting

**Mac: "Install.command cannot be opened because it is from an unidentified developer"**
Right-click (or Control-click) `Install.command` → **Open** → **Open**. You only need to do this once; the installer clears the warning for the other files.
If it still won't open, go to **System Settings → Privacy & Security** and click **Open Anyway** for it.

**Windows: "Windows protected your PC"**
Click **More info** → **Run anyway**.

**The install stopped with an error**
Usually the internet connection dropped. Run Install again: it picks up where it left off.
A full log is in `runtime/install.log` inside the LucielLyric folder.

**The browser didn't open**
Go to <http://localhost:8000> yourself. If that port was busy, the black/Terminal window shows the address it used.

**"Luciel Lyric is not installed yet (or the folder was moved)"**
Run Install again. If you move the LucielLyric folder, Install must run once more. That takes about a minute.

**"vocal isolation is not available"**
The app still works; only the *Isolate vocals* option is off. This happens on Intel Macs.

**Fast / Accurate / Best, and the lyric aligner**
Those weights are not in the installer. The first Sync that needs one downloads it into `data/models` (a progress bar shows the download) and then works offline. The bundled `base.en` model is only the offline fallback. A blocked `huggingface.co` shows an error on the Sync panel instead of a silent bad sync. `HF_ENDPOINT` applies to that download too.

**It can't download the AI models (firewall, or huggingface.co blocked)**
* Use a mirror:
  * Mac/Linux: `HF_ENDPOINT=https://hf-mirror.com ./install.sh`
  * Windows: run `set HF_ENDPOINT=https://hf-mirror.com` first, then `Install.bat`
* Or put the model files in place by hand (see below).

**Start over**
Delete the `runtime` folder inside Luciel Lyric and run Install again. Your projects are in `data/`, and the models in `models/` are kept.

**Uninstall**
Delete the LucielLyric folder. That's everything.

---

## Details (for the curious)

**What Install does**
1. It downloads [uv](https://docs.astral.sh/uv/), a small Python installer (version 0.13.3), into `runtime/` and checks it against a checksum.
2. uv downloads a private Python 3.12 into `runtime/python`.
3. It installs the app's packages into `runtime/venv` (about 1.5 GB), including a CPU-only PyTorch for vocal isolation.
4. It downloads the two AI models into `models/` (about 232 MB). They're pinned versions, checked by SHA-256, and downloads resume if interrupted.
5. It checks for ffmpeg, the video engine. If your computer doesn't have a suitable one, it downloads a portable copy.

**What you need**
* Windows 10/11 (64-bit), macOS 12+ (Apple Silicon recommended), or a 64-bit Linux
* About 2.5 GB of free disk space
* 4 GB RAM (8 GB recommended)

**Installing the models manually**

Download these files on any computer:
* From `https://huggingface.co/Systran/faster-whisper-base.en/resolve/3d3d5dee26484f91867d81cb899cfcf72b96be6c/<file>`:
  * `config.json`
  * `model.bin`
  * `tokenizer.json`
  * `vocabulary.txt`
* From `https://huggingface.co/adefossez/HTDemucs/resolve/cbc8a9b1a87023b7fd74e7b3412e6321c0eab003/<file>`:
  * `htdemucs.yaml`
  * `955717e8.safetensors`

Then place them like this (also shown in `models/README.txt`):
```
models/faster-whisper-base.en/{config.json, model.bin, tokenizer.json, vocabulary.txt}
models/hf/hub/models--adefossez--HTDemucs/snapshots/cbc8a9b1a87023b7fd74e7b3412e6321c0eab003/{htdemucs.yaml, 955717e8.safetensors}
```
Install verifies them and skips the download. Copying the whole `models/` folder from another Luciel Lyric install, or from the big `LucielLyric.zip`, works too.

**ffmpeg**
Install handles ffmpeg automatically. If you'd rather use your own copy:
* Mac: `brew install ffmpeg`
* Windows: `winget install Gyan.FFmpeg`
* Linux: `sudo apt install ffmpeg`

To force a particular copy, set `LUCIEL_FFMPEG` to `system`, `bundled`, or a folder path.

**Installing with no internet at all**
Copy over a LucielLyric folder that was already installed on a computer with the same operating system, and run Install once there. The packages can't be fetched offline.

**Folder layout**

| Path | What it is |
|---|---|
| `Install.*` / `install.sh` | the installer |
| `Start Luciel Lyric.*` / `start.sh` | starts the app |
| `app/`, `static/` | the app itself |
| `models/` | the AI models |
| `docs/` | demo song, sample video, screenshots |
| `scripts/` | installer internals and tools (`fetch_models.py`, `check_setup.py`, `smoke_test.py`) |
| `runtime/` | created by Install: uv, private Python, packages |
| `data/` | created when you use the app: uploads, renders, fonts |

**Licences**
* Fonts are SIL Open Font License; the texts are in `static/fonts/`.
* Whisper base.en is MIT (OpenAI, converted by Systran).
* Demucs is MIT (Meta).
