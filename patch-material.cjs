const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/materials/ChunkMaterial.js');
let code = fs.readFileSync(filePath, 'utf-8');

// Inject our custom attribute and varying into the vertex shader
const vertexInjection = `
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      \`
      #include <common>
      attribute float packedData;
      varying float vPackedData;
      \`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      \`
      #include <begin_vertex>
      vPackedData = packedData;
      \`
    );
`;

code = code.replace(
  "material.onBeforeCompile = (shader) => {",
  "material.onBeforeCompile = (shader) => {" + vertexInjection
);

// Replace vColor usage in fragment shader
const fragInjections = `
      #ifdef USE_MAP
        // packedData: Bits 0-3 (Sun), Bits 4-7 (Blk), Bits 8-9 (AO), Bits 10-17 (TexId)
        float pd = floor(vPackedData + 0.1);
        float texId = floor(pd / 1024.0);
        float tileX = mod(texId, uAtlasGridSize);
        float tileY = floor(texId / uAtlasGridSize);
        
        // Extract lighting and AO
        float lightAO = mod(pd, 1024.0);
        float sun = mod(lightAO, 16.0);
        float blk = mod(floor(lightAO / 16.0), 16.0);
        float ao = mod(floor(lightAO / 256.0), 4.0);
        
        float aoMultiplier = 0.5 + ao * 0.166;
        float sunBonus = (sun / 15.0) * 1.5;
        float blkBonus = (blk / 15.0) * 3.0;
        
        float finalLight = aoMultiplier + max(sunBonus, blkBonus);
        
        vec2 localUv = fract(vMapUv);
        if (texId == 18.0 || texId == 19.0) { 
           localUv.x = fract(localUv.x + uTime * 0.1);
           localUv.y = fract(localUv.y + uTime * 0.1);
        }
        
        localUv = clamp(localUv, 0.001, 0.999);
        vec2 atlasUv = (vec2(tileX, tileY) + localUv) / uAtlasGridSize;
        
        vec4 texelColor = texture2D( map, atlasUv );
        diffuseColor *= texelColor;
        
        vec3 heatColor;
        if (finalLight < 1.0) {
           float t = clamp((finalLight - 0.5) * 2.0, 0.0, 1.0);
           heatColor = mix(vec3(0.0, 0.0, 0.5), vec3(0.0, 0.8, 0.8), t);
        } else {
           float t = clamp((finalLight - 1.0) / 4.0, 0.0, 1.0);
           if (t < 0.5) {
              heatColor = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), t * 2.0);
           } else {
              heatColor = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), (t - 0.5) * 2.0);
           }
        }

        diffuseColor.rgb = mix(diffuseColor.rgb * finalLight, heatColor, uDebugLighting);
      #endif
`;

const oldFragShaderBodyRegex = /#ifdef USE_MAP[\s\S]*?#endif/;
code = code.replace(oldFragShaderBodyRegex, fragInjections.trim());

const varyInjection = `
      varying float vPackedData;
`;
code = code.replace(
  "uniform float uDebugLighting;",
  "uniform float uDebugLighting;" + varyInjection
);

// We need to disable the vertexColors on the material otherwise ThreeJS complains
code = code.replace(/vertexColors: true,/g, 'vertexColors: false,');

fs.writeFileSync(filePath, code);
console.log('ChunkMaterial.js patched!');
