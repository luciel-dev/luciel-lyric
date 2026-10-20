Luciel Lyric AI models
===================
setup.sh / setup.bat fills this folder automatically (tools/fetch_models.py, ~232 MB, one time).
After that Luciel Lyric never goes online. Expected layout (see INSTALL.md, "Installing the models manually"):

models/
  faster-whisper-base.en/          from https://huggingface.co/Systran/faster-whisper-base.en
    config.json  model.bin  tokenizer.json  vocabulary.txt
  hf/hub/models--adefossez--HTDemucs/          from https://huggingface.co/adefossez/HTDemucs
    refs/main                       (text file containing: cbc8a9b1a87023b7fd74e7b3412e6321c0eab003)
    snapshots/cbc8a9b1a87023b7fd74e7b3412e6321c0eab003/
      htdemucs.yaml  955717e8.safetensors

Check with:  python tools/fetch_models.py --check
