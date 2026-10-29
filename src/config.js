import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const MODELS_DIR = process.env.TABIBU_MODELS_DIR || path.join(ROOT, 'models')
export const DATA_DIR = process.env.TABIBU_DATA_DIR || path.join(ROOT, 'data')
export const INDEX_FILE = path.join(DATA_DIR, 'index.json')
export const EVAL_DIR = path.join(ROOT, 'eval')

// Every model is a QVAC registry entry. `registry` names the constant exported by
// @qvac/sdk; setup verifies the downloaded file against that constant's sha256.
export const MODELS = {
  embed: {
    registry: 'EMBEDDINGGEMMA_300M_Q8_0',
    file: 'embeddinggemma-300M-Q8_0.gguf',
    url: 'https://huggingface.co/unsloth/embeddinggemma-300m-GGUF/resolve/6661a6504c30d8304af13455cb4a5d4f5bc6011f/embeddinggemma-300M-Q8_0.gguf',
    role: 'Embeddings for guideline search',
    license: 'Gemma Terms of Use'
  },
  chat: {
    registry: 'QWEN3_1_7B_INST_Q4',
    file: 'Qwen3-1.7B-Q4_0.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_0.gguf',
    role: 'Grounded answer generation',
    license: 'Apache-2.0'
  },
  translate: {
    registry: 'AFRICAN_4B_TRANSLATION_Q4_K_M',
    file: 'AfriqueGemma-4B.Q4_K_M.gguf',
    url: 'https://huggingface.co/mradermacher/AfriqueGemma-4B-GGUF/resolve/e1324d25db75de68b604093e527272f6c5aba69f/AfriqueGemma-4B.Q4_K_M.gguf',
    role: 'Swahili <-> English translation',
    license: 'CC-BY-4.0 (McGill-NLP/AfriqueGemma-4B, built on Gemma 3)'
  }
}

// Guidelines are downloaded from the publisher at setup time and never committed.
export const SOURCES = [
  {
    id: 'who-ccm-2011',
    title: 'Caring for the sick child in the community: Participant manual',
    publisher: 'WHO and UNICEF, 2011',
    url: 'https://iris.who.int/server/api/core/bitstreams/c39c52ff-f785-45bc-94f1-2717909dfcdb/content',
    landing: 'https://www.who.int/publications/i/item/9789241548045',
    file: 'who-ccm-2011.pdf'
  }
]

export const RETRIEVAL = {
  topK: 4,
  // Below this cosine score the question is treated as outside the loaded
  // guidelines. Calibrated on eval/questions.json (see eval/README.md).
  minScore: Number(process.env.TABIBU_MIN_SCORE || 0.45)
}

export const PORT = Number(process.env.PORT || 4317)
