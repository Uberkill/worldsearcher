const fs = require('fs');
const file = 'src/components/DynamicSky.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add storm colors to useMemo block
const colorBlockStart = content.indexOf('  const dayColor = useMemo(() => new THREE.Color(');
if (colorBlockStart === -1) throw new Error("Could not find dayColor");

const colorBlockReplacement = `  const dayColor = useMemo(() => new THREE.Color('#475569'), []);
  const nightColor = useMemo(() => new THREE.Color('#020617'), []);
  const dawnColor = useMemo(() => new THREE.Color('#cbd5e1'), []);
  const fogColor = useMemo(() => new THREE.Color('#475569'), []);
  
  const stormDayColor = useMemo(() => new THREE.Color('#334155'), []);
  const stormNightColor = useMemo(() => new THREE.Color('#0f172a'), []);
  const stormDawnColor = useMemo(() => new THREE.Color('#64748b'), []);
  
  const finalDayColor = useMemo(() => new THREE.Color(), []);
  const finalNightColor = useMemo(() => new THREE.Color(), []);
  const finalDawnColor = useMemo(() => new THREE.Color(), []);
  
  const stormFactorRef = useRef(0);
  const lightningFlash = useRef(0);
  const nextLightningTime = useRef(0);
  const isRaining = useStore(state => state.isRaining);`;

content = content.replace(/  const dayColor = useMemo\(\(\) => new THREE\.Color\('#475569'\), \[\]\);\s*const nightColor = useMemo\(\(\) => new THREE\.Color\('#020617'\), \[\]\);\s*const dawnColor = useMemo\(\(\) => new THREE\.Color\('#cbd5e1'\), \[\]\);\s*const fogColor = useMemo\(\(\) => new THREE\.Color\('#475569'\), \[\]\);/g, colorBlockReplacement);

// 2. Add stormFactor update and fog color LERP
const fogStart = content.indexOf('    // ── Dynamic Fog Color ──');
const fogEnd = content.indexOf('    if (skyRef.current?.material?.uniforms?.sunPosition) {');

const newFogLogic = `    // ── Weather & Fog ──
    stormFactorRef.current = THREE.MathUtils.lerp(stormFactorRef.current, isRaining ? 1.0 : 0.0, delta * 0.5);
    
    finalDayColor.copy(dayColor).lerp(stormDayColor, stormFactorRef.current);
    finalNightColor.copy(nightColor).lerp(stormNightColor, stormFactorRef.current);
    finalDawnColor.copy(dawnColor).lerp(stormDawnColor, stormFactorRef.current);

    if (scene.fog?.color) {
      if (sunY > 0.3) {
        fogColor.copy(finalDayColor);
      } else if (sunY > 0) {
        fogColor.copy(finalDawnColor).lerp(finalDayColor, sunY / 0.3);
      } else if (sunY > -0.3) {
        fogColor.copy(finalNightColor).lerp(finalDawnColor, (sunY + 0.3) / 0.3);
      } else {
        fogColor.copy(finalNightColor);
      }
      scene.fog.color.copy(fogColor);
      state.scene.background = fogColor;
      
      const baseDensity = 1.0 / (renderDistance * 14);
      scene.fog.density = THREE.MathUtils.lerp(baseDensity, 0.04, stormFactorRef.current);
    }
    
    // Lightning Spawner
    if (isRaining && stormFactorRef.current > 0.8) {
      if (state.clock.getElapsedTime() > nextLightningTime.current) {
         lightningFlash.current = 4.0;
         nextLightningTime.current = state.clock.getElapsedTime() + 5 + Math.random() * 15; // 5 to 20 sec
         
         import('../utils/SFXManager').then(({ sfxManager }) => {
            const distance = 50 + Math.random() * 200; 
            const delay = distance / 343;
            sfxManager.playThunder(delay);
         });
      }
    } else if (!isRaining) {
      nextLightningTime.current = state.clock.getElapsedTime() + 2;
    }
    
    lightningFlash.current = THREE.MathUtils.lerp(lightningFlash.current, 0, delta * 15.0);

`;

content = content.substring(0, fogStart) + newFogLogic + content.substring(fogEnd);

// 3. Update lighting LERPs and Sky Shader Uniforms
const ambientStart = content.indexOf('    if (ambientRef.current) {');
const ambientEnd = content.indexOf('    const px = state.camera.position.x;');

const newAmbientLogic = `    // Sky Shader Mie Scattering
    if (skyRef.current?.material?.uniforms) {
      const uniforms = skyRef.current.material.uniforms;
      if (uniforms.sunPosition) {
        const len = Math.sqrt(sunX*sunX + sunY*sunY + 0.2*0.2);
        uniforms.sunPosition.value.set(sunX/len, sunY/len, 0.2/len);
      }
      if (uniforms.mieCoefficient) uniforms.mieCoefficient.value = THREE.MathUtils.lerp(0.004, 0.1, stormFactorRef.current);
      if (uniforms.turbidity) uniforms.turbidity.value = THREE.MathUtils.lerp(8, 20, stormFactorRef.current);
      if (uniforms.rayleigh) uniforms.rayleigh.value = THREE.MathUtils.lerp(1.8, 0.2, stormFactorRef.current);
    }

    let targetAmbient = isRaining ? 0.3 : (isNight ? 0.06 : THREE.MathUtils.lerp(0.06, 0.5, Math.max(0, sunY)));
    let targetHemi = isRaining ? 0.4 : (isNight ? 0.04 : THREE.MathUtils.lerp(0, 0.65, Math.max(0, sunY)));
    
    targetAmbient += lightningFlash.current;
    targetHemi += lightningFlash.current * 0.5;

    if (ambientRef.current) {
      ambientRef.current.intensity = THREE.MathUtils.lerp(ambientRef.current.intensity, targetAmbient, delta * 2.0);
    }
    if (hemiRef.current) {
      hemiRef.current.intensity = THREE.MathUtils.lerp(hemiRef.current.intensity, targetHemi, delta * 2.0);
      
      let hemiBaseColor = 0x475569;
      if (isNight) hemiBaseColor = 0x020617;
      else if (isSunset) hemiBaseColor = sunY > 0 ? 0xcbd5e1 : 0x1e293b;
      
      const stormyHemi = 0x334155;
      const finalHemiColor = new THREE.Color(hemiBaseColor).lerp(new THREE.Color(stormyHemi), stormFactorRef.current);
      hemiRef.current.color.copy(finalHemiColor);
    }

`;

content = content.substring(0, ambientStart) + newAmbientLogic + content.substring(ambientEnd);

// 4. Update directional lights
const dirStart = content.indexOf('    // ── Light Intensity Fades & Safest Baton Pass ──');
const dirEnd = content.indexOf('    // ── Sun Vector Updates (Y-Axis Anchored) ──');

const newDirLogic = `    // ── Light Intensity Fades & Safest Baton Pass ──
    const baseSun = Math.max(0, (sunY - 0.1) * 2.8);
    const targetSun = isRaining ? 0.1 : baseSun; 
    const sunIntensity = sunRef.current ? THREE.MathUtils.lerp(sunRef.current.intensity, targetSun, delta * 2.0) : 0;
    
    const moonIntensity = isNight ? Math.max(0, (-sunY - 0.1) * 0.8) : 0;

    if (sunRef.current) sunRef.current.intensity = sunIntensity;
    if (moonRef.current) moonRef.current.intensity = moonIntensity;

    if (sunRef.current && moonRef.current) {
      if (sunIntensity <= 0.01 && sunRef.current.castShadow) {
        sunRef.current.castShadow = false;
        moonRef.current.castShadow = true;
      } else if (moonIntensity <= 0.01 && moonRef.current.castShadow) {
        moonRef.current.castShadow = false;
        sunRef.current.castShadow = true;
      }
      
      // Turn off shadows entirely in deep storm to save massive GPU overhead!
      if (isRaining && stormFactorRef.current > 0.8) {
         if (sunRef.current.castShadow) sunRef.current.castShadow = false;
         if (moonRef.current.castShadow) moonRef.current.castShadow = false;
      }
    }

`;

content = content.substring(0, dirStart) + newDirLogic + content.substring(dirEnd);


fs.writeFileSync(file, content, 'utf8');
console.log("Successfully rewrote DynamicSky.jsx!");
