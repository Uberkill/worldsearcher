import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';
import { useStore } from '../stores/useStore';

// NOTE: SSAO removed — its blue-noise sampling kernel tiles visibly across
// flat voxel surfaces (all block faces are 90° planes, which tricks SSAO into
// producing a repeating noise grid across the whole screen). The other effects
// below give a better visual result without any artifacts.

export const PostFX = () => {
  const isNight = useStore(state => state.isNightTime);

  return (
    <EffectComposer multisampling={4}>
      {/* Bloom — soft glow on bright sky pixels and sun disc */}
      <Bloom
        luminanceThreshold={isNight ? 0.3 : 0.88}
        luminanceSmoothing={0.5}
        intensity={isNight ? 0.55 : 0.18}
        mipmapBlur
        radius={0.7}
      />

      {/* Vignette — darkens screen edges for a cinematic look */}
      <Vignette
        offset={0.3}
        darkness={isNight ? 0.72 : 0.38}
        blendFunction={BlendFunction.NORMAL}
      />

      {/* ACES Filmic tone mapping — prevents blown-out white sky,
          makes shadows richer, colours more saturated and cinematic */}
      <ToneMapping
        blendFunction={BlendFunction.NORMAL}
        mode={ToneMappingMode.ACES_FILMIC}
        resolution={256}
        whitePoint={4.5}
        middleGrey={0.55}
        minLuminance={0.01}
        averageLuminance={1}
        adaptationRate={1}
      />
    </EffectComposer>
  );
};
