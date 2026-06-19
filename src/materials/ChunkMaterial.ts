import * as THREE from 'three';
import { ATLAS_GRID_SIZE } from '../utils/TextureAtlas';

export const createChunkMaterial = (textureAtlas: THREE.Texture, isTransparent = false): THREE.MeshLambertMaterial => {
  const material = isTransparent
    ? new THREE.MeshLambertMaterial({
        map: textureAtlas,
        transparent: true,
        alphaTest: 0.1, // Discard fully transparent pixels
        depthWrite: true, // MUST be true for blocky voxel alpha-tested leaves to occlude properly
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
      varying vec3 vWorldPos;
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
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      `
    );

    // 1. Declare our custom uniforms
    shader.fragmentShader =
      `
      uniform float uAtlasGridSize;
      uniform float uTime;
      uniform float uDebugLighting;
      uniform vec3 uDynamicLightPos;
      uniform float uDynamicLightIntensity;
      varying float vSun;
      varying float vBlk;
      varying float vAo;
      varying float vTexId;
      varying float vIsAnimated;
      varying vec3 vWorldPos;

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
        
        localUv.y = 1.0 - localUv.y; // Fix upside-down textures from flipY=false
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

    // 4. Inject our Hybrid Voxel Lighting logic AFTER the Lambert lighting step
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `
      #include <lights_fragment_end>
      
      // Calculate Non-Linear Voxel Light Values (Gamma correction for better falloff)
      float rawSky = max(0.0, vSun / 15.0);
      float rawTorch = vBlk / 15.0;
      
      // Feature 1: Animated Torch Flickering
      float flicker = 1.0;
      if (rawTorch > 0.0) {
          // Add chaotic pseudo-random offsets based on world position so torches don't sync up
          float offset1 = vWorldPos.x * 12.9898 + vWorldPos.y * 78.233 + vWorldPos.z * 37.719;
          float offset2 = vWorldPos.x * 4.1414 + vWorldPos.z * 9.2311;
          flicker += sin(uTime * 15.0 + offset1) * 0.05;
          flicker += cos(uTime * 22.0 + offset2) * 0.03;
      }
      
      float skyLight = pow(rawSky, 2.0); 
      float torchLight = pow(rawTorch, 2.2) * flicker;
      float aoFactor = 0.5 + (vAo / 3.0) * 0.5;
      
      // Feature 2: Dynamic Hand-Held Lighting
      float dist = length(vWorldPos - uDynamicLightPos);
      float dynLight = max(0.0, 1.0 - (dist / 14.0)) * uDynamicLightIntensity;
      float dynLightCurve = pow(dynLight, 2.2);
      
      // Combine static torch light with dynamic torch light
      float totalTorchLight = clamp(torchLight + dynLightCurve, 0.0, 1.0);
      
      // Fake Face Normal Shading for Torchlight (Restores 3D Depth in Caves)
      float faceShade = 1.0;
      if (abs(normal.x) > 0.5) faceShade = 0.8;
      else if (abs(normal.z) > 0.5) faceShade = 0.6;
      else if (normal.y < -0.5) faceShade = 0.5;
      
      vec3 torchColor = vec3(1.2, 0.9, 0.5) * totalTorchLight * faceShade;
      
      // Modulate Direct Global Light (Sun)
      reflectedLight.directDiffuse *= skyLight;
      
      // Modulate Indirect Light (Sky Ambient + AO)
      // Keep a tiny 0.05 floor so the surface of the moon isn't completely pitch black
      reflectedLight.indirectDiffuse *= max(0.05, skyLight); 
      reflectedLight.indirectDiffuse *= aoFactor; // AO only affects ambient/indirect!
      
      // Add Torch Light (already face-shaded) directly to indirect diffuse!
      reflectedLight.indirectDiffuse += torchColor * diffuseColor.rgb;
      
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
    shader.uniforms.uDynamicLightPos = { value: new THREE.Vector3() };
    shader.uniforms.uDynamicLightIntensity = { value: 0 };

    // We attach the shader to the material so we can access it later (e.g. for animations)
    material.userData.shader = shader;
  };

  return material;
};
