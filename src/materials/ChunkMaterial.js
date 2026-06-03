import * as THREE from 'three';
import { ATLAS_GRID_SIZE } from '../utils/TextureAtlas';

export const createChunkMaterial = (textureAtlas, isTransparent = false) => {
  const material = isTransparent
    ? new THREE.MeshPhongMaterial({
        map: textureAtlas,
        transparent: true,
        alphaTest: 0.1, // Discard fully transparent pixels
        shininess: 60,
        specular: new THREE.Color('#ffffff'),
        depthWrite: false,
        vertexColors: false, // We explicitly use standard vertex colors for geometry binding
      })
    : new THREE.MeshLambertMaterial({
        map: textureAtlas,
        vertexColors: false, // We explicitly use standard vertex colors for geometry binding
      });

  // Removed shadowSide = THREE.BackSide because it breaks greedy mesh hollow shadows

  // Inject custom shader logic for seamless greedy mesh UV repetition
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
      #include <common>
      attribute float packedData;
      varying float vSun;
      varying float vBlk;
      varying float vAo;
      varying float vTexId;
      varying float vIsAnimated;
      `
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      float pd = floor(packedData + 0.1);
      vIsAnimated = floor(pd / 262144.0);
      vTexId = mod(floor(pd / 1024.0), 256.0);
      float lightAO = mod(pd, 1024.0);
      vSun = mod(lightAO, 16.0);
      vBlk = mod(floor(lightAO / 16.0), 16.0);
      vAo = mod(floor(lightAO / 256.0), 4.0);
      `
    );

    // 1. Declare our custom uniforms
    shader.fragmentShader = `
      uniform float uAtlasGridSize;
      uniform float uTime;
      uniform float uDebugLighting;
      varying float vSun;
      varying float vBlk;
      varying float vAo;
      varying float vTexId;
      varying float vIsAnimated;

    ` + shader.fragmentShader;

    // 2. Override map_fragment to map the UVs from the texture atlas
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      #ifdef USE_MAP
        float tileX = mod(floor(vTexId + 0.1), uAtlasGridSize);
        float tileY = floor(floor(vTexId + 0.1) / uAtlasGridSize);
        
        vec2 localUv = fract(vMapUv);
        if (vIsAnimated >= 1.0) { 
           localUv.x = fract(localUv.x + uTime * 0.1);
           localUv.y = fract(localUv.y + uTime * 0.1);
        }
        
        localUv = clamp(localUv, 0.001, 0.999);
        vec2 atlasUv = (vec2(tileX, tileY) + localUv) / uAtlasGridSize;
        
        vec4 texelColor = texture2D( map, atlasUv );
        diffuseColor *= texelColor;
      #endif
      `
    );

    // 3. We MUST override color_fragment! 
    // Three.js normally multiplies diffuseColor by vColor here.
    // Since our vColor contains [light, texId, 0], this would break the colors!
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      // We explicitly DO NOT multiply diffuseColor by vColor.
      `
    );

    // 4. Inject our Hybrid Voxel Lighting logic into the Lambert lighting step
    // 4. Inject our Hybrid Voxel Lighting logic AFTER the Lambert lighting step
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `
      #include <lights_fragment_end>
      
      // Calculate Voxel Light Values (0.0 to 1.0)
      float skyLight = max(0.05, vSun / 15.0);
      float torchLight = vBlk / 15.0;
      float aoFactor = 0.5 + (vAo / 3.0) * 0.5;
      
      // Voxel Colors
      vec3 torchColor = vec3(1.2, 0.9, 0.5) * torchLight;
      
      // Link Three.js Ambient Light to Voxel Sky Light!
      // This makes caves pitch black except for torches.
      reflectedLight.indirectDiffuse *= skyLight;
      
      // Add Torch Light directly to ambient!
      reflectedLight.indirectDiffuse += torchColor * diffuseColor.rgb;
      
      // Apply Voxel Ambient Occlusion to ALL light!
      reflectedLight.indirectDiffuse *= aoFactor;
      reflectedLight.directDiffuse *= aoFactor;
      
      // Apply Debug Lighting heatmap if active
      if (uDebugLighting > 0.5) {
          float lightLevel = max(vSun, vBlk) / 15.0;
          float finalLight = (0.05 + lightLevel * 0.95) * (0.6 + (vAo / 3.0) * 0.4);
          vec3 heatColor;
          if (finalLight < 1.0) {
             float t = clamp((finalLight - 0.5) * 2.0, 0.0, 1.0);
             heatColor = mix(vec3(0.0, 0.0, 0.5), vec3(0.0, 0.8, 0.8), t);
          } else {
             heatColor = vec3(0.0, 0.8, 0.8);
          }
          reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, heatColor * diffuseColor.rgb, uDebugLighting);
          reflectedLight.directDiffuse *= (1.0 - uDebugLighting); // Disable directional lighting in debug mode
      }
      `
    );

    // Set custom uniforms
    shader.uniforms.uAtlasGridSize = { value: ATLAS_GRID_SIZE };
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uDebugLighting = { value: 0 };
    
    // We attach the shader to the material so we can access it later (e.g. for animations)
    material.userData.shader = shader;
  };

  return material;
};
