# Synthesizes each narration line with Kokoro (offline) and writes timings.json.
import json, sys, os
import soundfile as sf
from kokoro_onnx import Kokoro
d = os.path.dirname(os.path.abspath(__file__))
k = Kokoro(os.path.join(d, 'kokoro-v1.0.onnx'), os.path.join(d, 'voices-v1.0.bin'))
voice = sys.argv[1] if len(sys.argv) > 1 else 'af_heart'
lines = json.load(open(os.path.join(d, 'narration.json')))
timings = {}
os.makedirs(os.path.join(d, 'clips'), exist_ok=True)
for l in lines:
    samples, sr = k.create(l['text'], voice=voice, speed=1.0, lang='en-us')
    path = os.path.join(d, 'clips', l['id'] + '.wav')
    sf.write(path, samples, sr)
    timings[l['id']] = round(len(samples) / sr, 2)
    print(l['id'], timings[l['id']])
json.dump({'voice': voice, 'timings': timings}, open(os.path.join(d, 'timings.json'), 'w'), indent=2)
