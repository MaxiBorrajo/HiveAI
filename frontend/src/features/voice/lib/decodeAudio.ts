/** What Whisper was trained on: anything else has to be resampled first. */
export const WHISPER_SAMPLE_RATE = 16_000;

/**
 * Averages the channels of a recording into one. Always a new array: the
 * result is handed over to the worker, which detaches it.
 */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0].slice();
  const mono = new Float32Array(channels[0]?.length ?? 0);
  for (const channel of channels) {
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
  }
  return mono;
}

/**
 * Turns any audio the browser can play (a recording, an mp3, a wav...) into
 * 16 kHz mono samples. Decoding into a 16 kHz context does the resampling.
 */
export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE });
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from(
      { length: buffer.numberOfChannels },
      (_, i) => buffer.getChannelData(i),
    );
    return toMono(channels);
  } finally {
    void context.close();
  }
}
