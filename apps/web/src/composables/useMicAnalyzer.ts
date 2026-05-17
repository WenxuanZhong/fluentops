import { ref } from 'vue';
import { createUint8Summer } from '../lib/wasm/uint-sum';

export function useMicAnalyzer() {
  const levelBars = ref([14, 18, 16, 22]);
  const levelText = ref('Ready');

  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let animationFrame = 0;
  let attachToken = 0;

  async function attach(stream: MediaStream) {
    cleanup();
    const myToken = ++attachToken;

    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
    if (myToken !== attachToken) {
      void ctx.close().catch(() => {});
      return;
    }

    const localAnalyser = ctx.createAnalyser();
    localAnalyser.fftSize = 256;
    const localSource = ctx.createMediaStreamSource(stream);
    localSource.connect(localAnalyser);

    const buffer = new Uint8Array(localAnalyser.frequencyBinCount);
    const sum = await createUint8Summer();

    if (myToken !== attachToken) {
      localSource.disconnect();
      localAnalyser.disconnect();
      void ctx.close().catch(() => {});
      return;
    }

    audioContext = ctx;
    analyser = localAnalyser;
    source = localSource;

    const tick = () => {
      if (!analyser || myToken !== attachToken) return;
      analyser.getByteFrequencyData(buffer);

      const chunkSize = Math.max(1, Math.floor(buffer.length / 4));
      const nextBars = [0, 1, 2, 3].map((index) => {
        const slice = buffer.slice(index * chunkSize, (index + 1) * chunkSize);
        const average = slice.length > 0 ? sum(slice) / slice.length : 0;
        return Math.max(12, Math.min(38, Math.round((average / 255) * 38)));
      });

      const average = Math.round(nextBars.reduce((total, value) => total + value, 0) / nextBars.length);
      levelBars.value = nextBars;
      levelText.value = average > 24 ? 'Hot mic' : average > 16 ? 'Speaking' : 'Listening';
      animationFrame = requestAnimationFrame(tick);
    };

    tick();
  }

  function cleanup() {
    attachToken += 1;
    cancelAnimationFrame(animationFrame);
    source?.disconnect();
    analyser?.disconnect();
    source = null;
    analyser = null;
    if (audioContext) {
      void audioContext.close().catch(() => {});
      audioContext = null;
    }
    levelBars.value = [14, 18, 16, 22];
    levelText.value = 'Ready';
  }

  return {
    levelBars,
    levelText,
    attach,
    cleanup,
  };
}
